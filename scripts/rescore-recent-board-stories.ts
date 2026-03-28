import { config } from "dotenv";
import Module from "node:module";

config({ path: ".env.local", override: false });
config({ path: ".env", override: false });

type ModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

const moduleLoader = Module as ModuleLoader;
const originalLoad = moduleLoader._load;
moduleLoader._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
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

  const hours = Math.max(1, Number(getArg("hours") ?? "24"));
  const limit = Math.max(1, Number(getArg("limit") ?? "150"));
  const pendingOnly = getArg("pendingOnly") !== "false";
  const sort = getArg("sort") === "score" ? "score" : "recent";

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const { scoreStory } = await import("../src/server/services/board/story-scorer");

  try {
    const { rows } = await pool.query<{ id: string }>(
      `
        with story_source_flags as (
          select
            bs.story_id,
            bool_and(coalesce((s.config_json->>'signalOnly')::boolean, false)) as all_signal_only
          from board_story_sources bs
          inner join board_feed_items fi on fi.id = bs.feed_item_id
          inner join board_sources s on s.id = fi.source_id
          group by bs.story_id
        )
        select c.id
        from board_story_candidates c
        inner join story_source_flags f on f.story_id = c.id
        where
          c.last_seen_at >= now() - ($1::text || ' hours')::interval
          and not f.all_signal_only
          and coalesce((c.metadata_json->'editorialFeedback'->>'irrelevant')::boolean, false) = false
          and (
            not $2::boolean
            or c.score_json is null
            or not (c.score_json ? 'lastScoredAt')
          )
        order by
          ${
            sort === "score"
              ? "case when jsonb_typeof(c.score_json->'lastScoredAt') = 'string' then coalesce((c.score_json->>'overall')::int, c.surge_score, 0) else 0 end desc, c.last_seen_at desc"
              : "c.last_seen_at desc"
          }
        limit $3
      `,
      [String(hours), pendingOnly, limit]
    );

    let completed = 0;
    for (const row of rows) {
      await scoreStory(row.id);
      completed += 1;
      if (completed % 10 === 0 || completed === rows.length) {
        console.log(`rescored ${completed}/${rows.length}`);
      }
    }

    console.log(
      JSON.stringify(
        {
          hours,
          limit,
          pendingOnly,
          sort,
          rescored: rows.length,
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
