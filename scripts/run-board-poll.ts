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

type PollKind = "rss" | "x" | "tiktok";

function parseIncludedKinds() {
  const includeArg = process.argv.find((arg) => arg.startsWith("--include="));
  if (!includeArg) {
    return new Set<PollKind>(["rss", "x", "tiktok"]);
  }

  const values = includeArg
    .slice("--include=".length)
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is PollKind => value === "rss" || value === "x" || value === "tiktok");

  return new Set<PollKind>(values);
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const startedAt = Date.now();
  const { runBoardSourcePollCycle } = await import("../src/server/services/board");
  const includedKinds = parseIncludedKinds();
  const result = await runBoardSourcePollCycle({
    includeRss: includedKinds.has("rss"),
    includeX: includedKinds.has("x"),
    includeTikTok: includedKinds.has("tiktok"),
    includeAlerts: hasFlag("--with-alerts"),
    includeDiscord: hasFlag("--with-discord"),
    includeHealth: hasFlag("--with-health"),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        durationMs: Date.now() - startedAt,
        includedKinds: Array.from(includedKinds),
        withAlerts: hasFlag("--with-alerts"),
        withDiscord: hasFlag("--with-discord"),
        withHealth: hasFlag("--with-health"),
        ...result,
      },
      null,
      2
    )
  );

  process.exit(0);
}

main().catch((error) => {
  console.error("[board-poll-worker] Poll failed");
  console.error(error);
  process.exit(1);
});
