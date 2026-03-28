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

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const kind = getArg("kind");
  const hours = Math.max(1, Number(getArg("hours") ?? "48"));
  const limit = Math.max(1, Number(getArg("limit") ?? "30"));
  const names = process.argv.slice(2).filter((entry) => !entry.startsWith("--"));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const { pollBoardSource } = await import("../src/server/services/board");

  try {
    const sourceNames =
      names.length > 0
        ? names
        : (
            await pool.query<{ name: string }>(
              `
                with recent_activity as (
                  select
                    s.name,
                    max(fi.published_at) as latest_published_at
                  from board_sources s
                  inner join board_feed_items fi on fi.source_id = s.id
                  where s.enabled = true
                    and ($1::text is null or s.kind = $1::board_source_kind)
                  group by s.name
                )
                select name
                from recent_activity
                where latest_published_at >= now() - ($2::text || ' hours')::interval
                order by latest_published_at desc nulls last
                limit $3
              `,
              [kind ?? null, String(hours), limit]
            )
          ).rows.map((row) => row.name);

    const results: Array<{
      source: string;
      ok: boolean;
      affectedStoryIds?: number;
      feedItemsIngested?: number;
      relationsCreated?: number;
      error?: string;
    }> = [];

    for (const sourceName of sourceNames) {
      try {
        const result = await pollBoardSource(sourceName);
        results.push({
          source: sourceName,
          ok: !result.failed,
          affectedStoryIds: result.affectedStoryIds.length,
          feedItemsIngested: result.feedItemsIngested,
          relationsCreated: result.relationsCreated,
          error: result.error ?? undefined,
        });
      } catch (error) {
        results.push({
          source: sourceName,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log(JSON.stringify({ refreshed: results.length, results }, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
