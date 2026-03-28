import path from "node:path";

import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

function readArg(index: number, fallback: string) {
  return process.argv[index] ?? fallback;
}

async function main() {
  const { backfillBoardSource } = await import("@/server/services/board");
  const sourceId = readArg(2, "").trim();
  const maxResults = Number(readArg(3, "6"));
  const lookbackHours = Number(readArg(4, "24"));
  const includeAlertsAndHealth = readArg(5, "false").trim().toLowerCase() === "true";

  if (!sourceId) {
    throw new Error("Usage: run-board-source-backfill.ts <sourceId> [maxResults] [lookbackHours] [includeAlertsAndHealth]");
  }

  const result = await backfillBoardSource(
    sourceId,
    maxResults,
    lookbackHours,
    includeAlertsAndHealth
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
