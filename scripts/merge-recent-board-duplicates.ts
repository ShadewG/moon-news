import { Pool, type PoolClient } from "pg";

type StoryRow = {
  id: string;
  slug: string;
  canonical_title: string;
  vertical: string | null;
  story_type: string;
  items_count: number;
  sources_count: number;
  last_seen_at: string | null;
  metadata_json: Record<string, unknown> | null;
  score_json: Record<string, unknown> | null;
};

type MatchRow = StoryRow & {
  tokens: string[];
  entityKeys: string[];
};

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(value: string) {
    if (!this.parent.has(value)) {
      this.parent.set(value, value);
    }
  }

  find(value: string): string {
    const current = this.parent.get(value);
    if (!current) {
      this.parent.set(value, value);
      return value;
    }

    if (current === value) {
      return value;
    }

    const root = this.find(current);
    this.parent.set(value, root);
    return root;
  }

  union(left: string, right: string) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parent.set(rightRoot, leftRoot);
    }
  }
}

const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "now",
  "of",
  "on",
  "or",
  "the",
  "their",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "why",
  "with",
  "your",
]);

const TITLE_MATCH_NOISE = new Set([
  "actor",
  "actress",
  "aged",
  "family",
  "film",
  "movie",
  "movies",
  "says",
  "show",
  "shows",
  "star",
  "stars",
  "singer",
  "rapper",
  "legendary",
  "week",
  "weeks",
  "year",
  "years",
  "old",
  "new",
  "latest",
]);

const TITLE_MATCH_ALIASES: Record<string, string> = {
  arrested: "arrest",
  arrests: "arrest",
  charged: "charge",
  charges: "charge",
  deaths: "death",
  dead: "death",
  died: "death",
  dies: "death",
  killed: "death",
  killing: "death",
  allegations: "allegation",
  allegation: "allegation",
  accused: "accuse",
  accuses: "accuse",
  abusing: "abuse",
  abused: "abuse",
  bans: "ban",
  banned: "ban",
  sued: "lawsuit",
  sues: "lawsuit",
  lawsuits: "lawsuit",
};

function coerceObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function tokenizeScoringText(value: string) {
  return value.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [];
}

function extractEntityKeys(title: string) {
  const counts = new Map<string, number>();
  const tokens = tokenizeScoringText(title);
  for (const token of tokens) {
    if (token.length < 4 || TITLE_STOPWORDS.has(token) || TITLE_MATCH_NOISE.has(token)) {
      continue;
    }

    const normalized = TITLE_MATCH_ALIASES[token] ?? token;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([token]) => token);
}

function tokenizeTitle(title: string): string[] {
  return Array.from(
    new Set(
      title
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .map((token) => TITLE_MATCH_ALIASES[token] ?? token)
        .filter(
          (token) =>
            token.length >= 3 &&
            !TITLE_STOPWORDS.has(token) &&
            !TITLE_MATCH_NOISE.has(token) &&
            !/^\d+$/.test(token)
        )
    )
  );
}

function countOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function flexibleOverlap(left: string[], right: string[]) {
  const overlapCount = countOverlap(left, right);
  if (overlapCount === 0 || left.length === 0 || right.length === 0) {
    return 0;
  }

  const strictOverlap = overlapCount / Math.max(left.length, right.length);
  const containmentOverlap = overlapCount / Math.min(left.length, right.length);
  return strictOverlap * 0.6 + containmentOverlap * 0.4;
}

function normalizeTitle(title: string) {
  return tokenizeTitle(title).join(" ");
}

function isLikelyDuplicate(left: MatchRow, right: MatchRow) {
  const leftNorm = normalizeTitle(left.canonical_title);
  const rightNorm = normalizeTitle(right.canonical_title);
  if (leftNorm && leftNorm === rightNorm) {
    return true;
  }

  if (
    left.canonical_title.toLowerCase().includes(right.canonical_title.toLowerCase()) ||
    right.canonical_title.toLowerCase().includes(left.canonical_title.toLowerCase())
  ) {
    return true;
  }

  const entityOverlap = countOverlap(left.entityKeys, right.entityKeys);
  const leftNonEntity = left.tokens.filter((token) => !left.entityKeys.includes(token));
  const rightNonEntity = right.tokens.filter((token) => !right.entityKeys.includes(token));
  const nonEntityOverlap = countOverlap(leftNonEntity, rightNonEntity);
  const overlap = Math.max(
    flexibleOverlap(left.tokens, right.tokens),
    flexibleOverlap(tokenizeTitle(left.canonical_title), tokenizeTitle(right.canonical_title))
  );

  if (entityOverlap >= 3 && nonEntityOverlap >= 1) {
    return true;
  }

  return entityOverlap >= 2 && nonEntityOverlap >= 1 && overlap >= 0.45;
}

function compareTargetPriority(left: MatchRow, right: MatchRow) {
  const leftScore = Number(left.score_json?.overall ?? 0);
  const rightScore = Number(right.score_json?.overall ?? 0);
  const leftSeen = left.last_seen_at ? Date.parse(left.last_seen_at) : 0;
  const rightSeen = right.last_seen_at ? Date.parse(right.last_seen_at) : 0;

  return (
    right.sources_count - left.sources_count ||
    right.items_count - left.items_count ||
    rightScore - leftScore ||
    rightSeen - leftSeen
  );
}

function mergeStringArrays(values: string[][]) {
  return Array.from(new Set(values.flat().filter(Boolean)));
}

async function recalcStoryMetrics(client: PoolClient, storyId: string) {
  const relations = await client.query<{
    source_id: string;
    published_at: string | null;
    sentiment_score: number | null;
    controversy_score: number | null;
    entity_keys_json: unknown;
  }>(
    `
      select
        fi.source_id,
        fi.published_at,
        fi.sentiment_score,
        fi.controversy_score,
        fi.entity_keys_json
      from board_story_sources bs
      inner join board_feed_items fi on fi.id = bs.feed_item_id
      where bs.story_id = $1
    `,
    [storyId]
  );

  const sourceIds = new Set<string>();
  let sentimentTotal = 0;
  let controversyTotal = 0;
  let maxControversy = 0;
  let firstSeenAt: string | null = null;
  let lastSeenAt: string | null = null;
  const entityCounts = new Map<string, number>();

  for (const row of relations.rows) {
    sourceIds.add(row.source_id);
    sentimentTotal += Number(row.sentiment_score ?? 0);
    controversyTotal += Number(row.controversy_score ?? 0);
    maxControversy = Math.max(maxControversy, Number(row.controversy_score ?? 0));

    if (row.published_at && (!firstSeenAt || row.published_at < firstSeenAt)) {
      firstSeenAt = row.published_at;
    }

    if (row.published_at && (!lastSeenAt || row.published_at > lastSeenAt)) {
      lastSeenAt = row.published_at;
    }

    for (const entityKey of coerceStringArray(row.entity_keys_json)) {
      entityCounts.set(entityKey, (entityCounts.get(entityKey) ?? 0) + 1);
    }
  }

  const itemCount = relations.rows.length;
  const sentimentScore =
    itemCount > 0
      ? Number(Math.max(-1, Math.min(1, sentimentTotal / itemCount)).toFixed(2))
      : 0;
  const controversyScore =
    itemCount > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((controversyTotal / itemCount) * 0.7 + maxControversy * 0.3 + Math.min(sourceIds.size * 2, 8))
          )
        )
      : 0;
  const entityKeys = Array.from(entityCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([entityKey]) => entityKey);

  await client.query(
    `
      update board_story_candidates
      set
        items_count = $2,
        sources_count = $3,
        sentiment_score = $4,
        controversy_score = $5,
        first_seen_at = coalesce($6::timestamptz, first_seen_at),
        last_seen_at = coalesce($7::timestamptz, last_seen_at),
        score_json = coalesce(score_json, '{}'::jsonb) || jsonb_build_object(
          'entityKeys', $8::jsonb,
          'lastComputedAt', to_jsonb(now()),
          'lastScoredAt', null
        ),
        updated_at = now()
      where id = $1
    `,
    [
      storyId,
      itemCount,
      sourceIds.size,
      sentimentScore,
      controversyScore,
      firstSeenAt,
      lastSeenAt,
      JSON.stringify(entityKeys),
    ]
  );
}

async function mergeCluster(client: PoolClient, cluster: MatchRow[]) {
  const [target, ...sources] = [...cluster].sort(compareTargetPriority);
  if (sources.length === 0) {
    return null;
  }

  const sourceIds = sources.map((story) => story.id);
  const sourceSlugs = sources.map((story) => story.slug);

  await client.query("begin");
  try {
    await client.query(
      `
        delete from board_story_sources source_rel
        using board_story_sources target_rel
        where source_rel.story_id = any($1::uuid[])
          and target_rel.story_id = $2::uuid
          and source_rel.feed_item_id = target_rel.feed_item_id
      `,
      [sourceIds, target.id]
    );

    await client.query(
      `
        delete from board_story_sources duplicate_rel
        using board_story_sources keep_rel
        where duplicate_rel.story_id = any($1::uuid[])
          and keep_rel.story_id = any($1::uuid[])
          and duplicate_rel.feed_item_id = keep_rel.feed_item_id
          and duplicate_rel.id > keep_rel.id
      `,
      [sourceIds]
    );

    await client.query(
      `update board_story_sources set story_id = $2 where story_id = any($1::uuid[])`,
      [sourceIds, target.id]
    );

    await client.query(
      `
        delete from board_story_ai_outputs source_output
        using board_story_ai_outputs target_output
        where source_output.story_id = any($1::uuid[])
          and target_output.story_id = $2::uuid
          and source_output.kind = target_output.kind
          and source_output.prompt_version = target_output.prompt_version
      `,
      [sourceIds, target.id]
    );

    await client.query(
      `update board_story_ai_outputs set story_id = $2, updated_at = now() where story_id = any($1::uuid[])`,
      [sourceIds, target.id]
    );

    await client.query(`delete from moon_story_scores where story_id = any($1::uuid[])`, [sourceIds]);

    await client.query(
      `
        update board_ticker_events
        set story_id = $2, updated_at = now()
        where story_id = any($1::uuid[])
      `,
      [sourceIds, target.id]
    );

    await client.query(
      `
        delete from board_surge_alerts source_alert
        using board_surge_alerts target_alert
        where source_alert.story_id = any($1::uuid[])
          and target_alert.story_id = $2::uuid
          and source_alert.alert_type = target_alert.alert_type
          and source_alert.dismissed_at is null
          and target_alert.dismissed_at is null
      `,
      [sourceIds, target.id]
    );

    await client.query(
      `
        update board_surge_alerts
        set story_id = $2, updated_at = now()
        where story_id = any($1::uuid[])
      `,
      [sourceIds, target.id]
    );

    const queueRows = await client.query<{
      id: string;
      story_id: string;
      updated_at: string;
    }>(
      `select id, story_id, updated_at from board_queue_items where story_id = any($1::uuid[]) or story_id = $2::uuid order by updated_at desc`,
      [sourceIds, target.id]
    );
    const targetQueue = queueRows.rows.find((row) => row.story_id === target.id) ?? null;
    const sourceQueues = queueRows.rows.filter((row) => row.story_id !== target.id);

    if (!targetQueue && sourceQueues.length > 0) {
      const [queueToKeep, ...queueToDelete] = sourceQueues;
      await client.query(
        `update board_queue_items set story_id = $2, updated_at = now() where id = $1::uuid`,
        [queueToKeep.id, target.id]
      );

      if (queueToDelete.length > 0) {
        await client.query(
          `delete from board_queue_items where id = any($1::uuid[])`,
          [queueToDelete.map((row) => row.id)]
        );
      }
    } else if (targetQueue && sourceQueues.length > 0) {
      await client.query(
        `delete from board_queue_items where id = any($1::uuid[])`,
        [sourceQueues.map((row) => row.id)]
      );
    }

    const targetStoryRow = await client.query<{
      metadata_json: Record<string, unknown> | null;
    }>(`select metadata_json from board_story_candidates where id = $1::uuid`, [target.id]);
    const targetMetadata = coerceObject(targetStoryRow.rows[0]?.metadata_json) ?? {};
    const mergedStoryIds = mergeStringArrays([
      coerceStringArray(targetMetadata.mergedStoryIds),
      sourceIds,
    ]);
    const mergedStorySlugs = mergeStringArrays([
      coerceStringArray(targetMetadata.mergedStorySlugs),
      sourceSlugs,
    ]);

    await client.query(
      `
        update board_story_candidates
        set
          metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
            'mergedStoryIds', $2::jsonb,
            'mergedStorySlugs', $3::jsonb,
            'lastMergedAt', to_jsonb(now())
          ),
          updated_at = now()
        where id = $1::uuid
      `,
      [target.id, JSON.stringify(mergedStoryIds), JSON.stringify(mergedStorySlugs)]
    );

    await client.query(`delete from board_story_candidates where id = any($1::uuid[])`, [sourceIds]);
    await recalcStoryMetrics(client, target.id);
    await client.query("commit");

    return {
      targetId: target.id,
      targetTitle: target.canonical_title,
      mergedCount: sources.length,
      mergedTitles: sources.map((story) => story.canonical_title),
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const stories = await pool.query<StoryRow>(
      `
        select
          id,
          slug,
          canonical_title,
          vertical,
          story_type,
          items_count,
          sources_count,
          last_seen_at::text,
          metadata_json,
          score_json
        from board_story_candidates
        where last_seen_at >= now() - interval '24 hours'
        order by last_seen_at desc
      `
    );

    const rows: MatchRow[] = stories.rows.map((row) => {
      const metadataJson = coerceObject(row.metadata_json);
      const entityKeys = coerceStringArray(metadataJson?.entityKeys);
      return {
        ...row,
        tokens: tokenizeTitle(row.canonical_title),
        entityKeys:
          entityKeys.length > 0
            ? entityKeys.map((token) => TITLE_MATCH_ALIASES[token] ?? token)
            : extractEntityKeys(row.canonical_title),
      };
    });

    const uf = new UnionFind();
    for (const row of rows) {
      uf.add(row.id);
    }

    for (let index = 0; index < rows.length; index += 1) {
      const left = rows[index];
      for (let inner = index + 1; inner < rows.length; inner += 1) {
        const right = rows[inner];
        if (left.vertical && right.vertical && left.vertical !== right.vertical) {
          continue;
        }

        if (isLikelyDuplicate(left, right)) {
          uf.union(left.id, right.id);
        }
      }
    }

    const clusters = new Map<string, MatchRow[]>();
    for (const row of rows) {
      const root = uf.find(row.id);
      const cluster = clusters.get(root) ?? [];
      cluster.push(row);
      clusters.set(root, cluster);
    }

    const duplicateClusters = Array.from(clusters.values())
      .filter((cluster) => cluster.length > 1)
      .sort((left, right) => right.length - left.length);

    const client = await pool.connect();
    try {
      const merged: Array<{
        targetId: string;
        targetTitle: string;
        mergedCount: number;
        mergedTitles: string[];
      }> = [];

      for (const cluster of duplicateClusters) {
        const result = await mergeCluster(client, cluster);
        if (result) {
          merged.push(result);
        }
      }

      console.log(
        JSON.stringify(
          {
            scannedStories: rows.length,
            duplicateClusters: duplicateClusters.length,
            mergedClusters: merged.length,
            mergedStories: merged.reduce((sum, item) => sum + item.mergedCount, 0),
            sample: merged.slice(0, 10),
          },
          null,
          2
        )
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
