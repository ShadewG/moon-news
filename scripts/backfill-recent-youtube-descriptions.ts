import { config } from "dotenv";
import Module from "node:module";

config({ path: ".env.local", override: false });
config({ path: ".env", override: false });

type ModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

const moduleLoader = Module as ModuleLoader;
const originalLoad = moduleLoader._load;
moduleLoader._load = function patchedLoad(
  request: string,
  parent: NodeModule | null,
  isMain: boolean
) {
  if (request === "server-only") {
    return {};
  }

  return originalLoad.call(this, request, parent, isMain);
};

import { Pool } from "pg";

function getArg(name: string) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function extractYouTubeVideoId(url: string) {
  const match =
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/i) ??
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/i) ??
    url.match(/\/shorts\/([A-Za-z0-9_-]{11})/i);

  return match?.[1] ?? null;
}

function normalizeYouTubeDescriptionSummary(summary: string | null | undefined) {
  if (!summary) {
    return null;
  }

  const lines = summary
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^https?:\/\//i.test(line) &&
        !/\b(use code|sponsor|sponsored|merch|patreon|follow me|follow us|discord server|gaming channel)\b/i.test(
          line
        ) &&
        !/^[A-Za-z0-9._-]+\s+https?:\/\//i.test(line)
    );

  const cleaned = lines
    .map((line) => line.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 20);

  if (cleaned.length === 0) {
    const collapsed = summary
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return collapsed.length > 0 ? collapsed.slice(0, 500) : null;
  }

  return cleaned.slice(0, 2).join(" ").slice(0, 500);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const hours = Math.max(1, Number(getArg("hours") ?? "48"));
  const limit = Math.max(1, Number(getArg("limit") ?? "30"));
  const names = process.argv.slice(2).filter((entry) => !entry.startsWith("--"));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const { fetchBoardRssItems } = await import("../src/server/services/board/rss");
  const { recomputeBoardStoryMetrics } = await import("../src/server/services/board");

  try {
    const sourceRows = (
      names.length > 0
        ? await pool.query<{
            id: string;
            name: string;
            config_json: Record<string, unknown> | null;
          }>(
            `
              select id, name, config_json
              from board_sources
              where kind = 'youtube_channel'
                and enabled = true
                and name = any($1::text[])
              order by name asc
            `,
            [names]
          )
        : await pool.query<{
            id: string;
            name: string;
            config_json: Record<string, unknown> | null;
          }>(
            `
              with recent_activity as (
                select
                  s.id,
                  s.name,
                  s.config_json,
                  max(fi.published_at) as latest_published_at
                from board_sources s
                inner join board_feed_items fi on fi.source_id = s.id
                where s.kind = 'youtube_channel' and s.enabled = true
                group by s.id, s.name, s.config_json
              )
              select id, name, config_json
              from recent_activity
              where latest_published_at >= now() - ($1::text || ' hours')::interval
              order by latest_published_at desc nulls last
              limit $2
            `,
            [String(hours), limit]
          )
    ).rows;

    const results: Array<{
      source: string;
      updatedFeedItems: number;
      errors?: string;
    }> = [];

    for (const row of sourceRows) {
      const configJson = row.config_json ?? {};
      const feedUrl =
        typeof configJson.feedUrl === "string" ? configJson.feedUrl : null;

      if (!feedUrl) {
        results.push({
          source: row.name,
          updatedFeedItems: 0,
          errors: "missing feedUrl",
        });
        continue;
      }

      try {
        const items = await fetchBoardRssItems(feedUrl);
        let updatedFeedItems = 0;

        for (const item of items) {
          const videoId = extractYouTubeVideoId(item.url);
          const externalId = videoId ?? item.externalId;
          const normalizedDescription = normalizeYouTubeDescriptionSummary(item.summary);

          const updateResult = await pool.query(
            `
              update board_feed_items
              set
                title = $3,
                summary = $4::text,
                content_hash = $5,
                metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
                  'youtubeRss', true,
                  'rawDescription', $6::text,
                  'normalizedDescription', $4::text,
                  'signalVersion', 0
                ),
                ingested_at = now()
              where source_id = $1
                and external_id = $2
            `,
            [
              row.id,
              externalId,
              item.title,
              normalizedDescription,
              item.contentHash,
              item.summary ?? null,
            ]
          );

          updatedFeedItems += updateResult.rowCount ?? 0;
        }

        results.push({
          source: row.name,
          updatedFeedItems,
        });
      } catch (error) {
        results.push({
          source: row.name,
          updatedFeedItems: 0,
          errors: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await recomputeBoardStoryMetrics();

    console.log(JSON.stringify({ refreshed: sourceRows.length, results }, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
