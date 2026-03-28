import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";

type SplitConfig = {
  targetStoryId: string;
  keepFeedItemIds: string[];
};

const SPLITS: SplitConfig[] = [
  {
    targetStoryId: "72e9908d-fea6-4a65-b6b6-39f7475a3a41",
    keepFeedItemIds: ["33d485a6-f7c3-4165-85cd-3271cd36cb6f"],
  },
  {
    targetStoryId: "d2e83f4f-1398-4dca-a0e2-61a4e35a9caf",
    keepFeedItemIds: [
      "bf4d2b9d-e6e8-40de-9177-1cfa6e11285f",
      "7f5a01c4-e84b-4aae-a753-9d9bf1b98c24",
    ],
  },
];

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSplitSlug(title: string, feedItemId: string) {
  const base = slugify(title).slice(0, 72) || "story";
  const suffix = createHash("sha1").update(`${title}:${feedItemId}`).digest("hex").slice(0, 6);
  return `${base}-${suffix}`;
}

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

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const client = await pool.connect();
    try {
      const summary: Array<{ targetStoryId: string; splitCount: number }> = [];

      for (const split of SPLITS) {
        await client.query("begin");
        try {
          const targetStoryRows = await client.query<{
            canonical_title: string;
            vertical: string | null;
            status: string;
            story_type: string;
            correction: boolean;
            formats_json: unknown;
            metadata_json: Record<string, unknown> | null;
          }>(
            `
              select
                canonical_title,
                vertical,
                status,
                story_type,
                correction,
                formats_json,
                metadata_json
              from board_story_candidates
              where id = $1::uuid
            `,
            [split.targetStoryId]
          );
          const targetStory = targetStoryRows.rows[0];
          if (!targetStory) {
            await client.query("rollback");
            continue;
          }

          const relations = await client.query<{
            relation_id: string;
            feed_item_id: string;
            title: string;
            source_id: string;
            published_at: string | null;
            sentiment_score: number | null;
            controversy_score: number | null;
            entity_keys_json: unknown;
            source_weight: number;
            is_primary: boolean;
            evidence_json: unknown;
          }>(
            `
              select
                bs.id as relation_id,
                bs.feed_item_id,
                fi.title,
                fi.source_id,
                fi.published_at::text,
                fi.sentiment_score,
                fi.controversy_score,
                fi.entity_keys_json,
                bs.source_weight,
                bs.is_primary,
                bs.evidence_json
              from board_story_sources bs
              inner join board_feed_items fi on fi.id = bs.feed_item_id
              where bs.story_id = $1::uuid
            `,
            [split.targetStoryId]
          );

          const keepFeedItemIds = new Set(split.keepFeedItemIds);
          const toSplit = relations.rows.filter((row) => !keepFeedItemIds.has(row.feed_item_id));

          for (const row of toSplit) {
            const slug = buildSplitSlug(row.title, row.feed_item_id);
            const entityKeys = coerceStringArray(row.entity_keys_json);
            const metadataJson = coerceObject(targetStory.metadata_json) ?? {};

            const inserted = await client.query<{ id: string }>(
              `
                insert into board_story_candidates (
                  slug,
                  canonical_title,
                  vertical,
                  status,
                  story_type,
                  surge_score,
                  controversy_score,
                  sentiment_score,
                  items_count,
                  sources_count,
                  correction,
                  formats_json,
                  first_seen_at,
                  last_seen_at,
                  score_json,
                  metadata_json,
                  updated_at
                )
                values (
                  $1,
                  $2,
                  $3,
                  $4,
                  $5,
                  0,
                  $6,
                  $7,
                  1,
                  1,
                  false,
                  $8::jsonb,
                  $9::timestamptz,
                  $10::timestamptz,
                  jsonb_build_object(
                    'entityKeys', $11::jsonb,
                    'lastComputedAt', to_jsonb(now()),
                    'lastScoredAt', null
                  ),
                  $12::jsonb,
                  now()
                )
                returning id
              `,
              [
                slug,
                row.title,
                targetStory.vertical,
                targetStory.status,
                targetStory.story_type === "correction" ? "normal" : targetStory.story_type,
                Number(row.controversy_score ?? 0),
                Number(row.sentiment_score ?? 0),
                JSON.stringify(targetStory.formats_json ?? ["Full Video"]),
                row.published_at,
                row.published_at,
                JSON.stringify(entityKeys),
                JSON.stringify({
                  ...metadataJson,
                  entityKeys,
                  lastSplitFromStoryId: split.targetStoryId,
                }),
              ]
            );

            await client.query(
              `update board_story_sources set story_id = $2::uuid where id = $1::uuid`,
              [row.relation_id, inserted.rows[0].id]
            );

            await recalcStoryMetrics(client, inserted.rows[0].id);
          }

          await recalcStoryMetrics(client, split.targetStoryId);
          await client.query("commit");
          summary.push({ targetStoryId: split.targetStoryId, splitCount: toSplit.length });
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      }

      console.log(JSON.stringify({ splitTargets: summary }, null, 2));
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
