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

function coerceObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const { resolveYouTubeChannelFeed } = await import("../src/server/providers/youtube");

  try {
    const { rows } = await pool.query<{
      id: string;
      name: string;
      config_json: unknown;
    }>(
      `
        select id, name, config_json
        from board_sources
        where kind = 'youtube_channel' and enabled = true
        order by name asc
      `
    );

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      const configJson = coerceObject(row.config_json) ?? {};
      const currentFeedUrl =
        typeof configJson.feedUrl === "string" ? configJson.feedUrl : null;
      const currentChannelId =
        typeof configJson.channelId === "string" ? configJson.channelId : null;

      if (currentFeedUrl && currentChannelId) {
        skipped += 1;
        continue;
      }

      const resolved = await resolveYouTubeChannelFeed({
        channelId: currentChannelId ?? undefined,
        channelHandle:
          typeof configJson.channelHandle === "string"
            ? configJson.channelHandle
            : undefined,
        channelUrl:
          typeof configJson.channelUrl === "string" ? configJson.channelUrl : undefined,
        channelName: row.name,
      });

      if (!resolved) {
        failed += 1;
        console.log(`fail ${row.name}: unable to resolve feed`);
        continue;
      }

      const nextConfig = {
        ...configJson,
        channelId: resolved.channelId,
        feedUrl: resolved.feedUrl,
        channelHandle:
          (typeof configJson.channelHandle === "string"
            ? configJson.channelHandle
            : resolved.channelHandle) ?? undefined,
        channelUrl:
          (typeof configJson.channelUrl === "string"
            ? configJson.channelUrl
            : resolved.channelUrl) ?? undefined,
      };

      await pool.query(
        `
          update board_sources
          set config_json = $2::jsonb, updated_at = now()
          where id = $1
        `,
        [row.id, JSON.stringify(nextConfig)]
      );

      updated += 1;
      if (updated % 10 === 0) {
        console.log(`updated ${updated}/${rows.length}`);
      }
    }

    console.log(
      JSON.stringify(
        {
          total: rows.length,
          updated,
          skipped,
          failed,
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
