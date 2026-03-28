import Module from "node:module";

import { config } from "dotenv";

const moduleLoader = Module as typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;

moduleLoader._load = function patchedLoad(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }

  return originalLoad.call(this, request, parent, isMain);
};

config({ path: ".env.local", override: false, quiet: true });
config({ path: ".env", override: false, quiet: true });

function parseMaxItems() {
  const arg = process.argv.find((value) => value.startsWith("--max-items="));
  if (!arg) {
    return undefined;
  }

  const parsed = Number(arg.slice("--max-items=".length));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

async function main() {
  const startedAt = Date.now();
  const { runBoardTikTokTranscriptEnrichmentCycle } = await import(
    "../src/server/services/board"
  );
  const result = await runBoardTikTokTranscriptEnrichmentCycle({
    maxItems: parseMaxItems(),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        durationMs: Date.now() - startedAt,
        maxItems: parseMaxItems() ?? null,
        ...result,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[board-tiktok-enrichment] Failed");
  console.error(error);
  process.exit(1);
});
