import { config } from "dotenv";

config({ path: ".env.local", override: false });
config({ path: ".env", override: false });

import { ilike } from "drizzle-orm";

import { getDb } from "../src/server/db/client";
import { boardStoryCandidates } from "../src/server/db/schema";
import { scoreStory } from "../src/server/services/board/story-scorer";

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

async function main() {
  const contains = getArg("contains");
  if (!contains) {
    throw new Error("Usage: npx tsx scripts/check-board-story-scores.ts --contains=substring");
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(boardStoryCandidates)
    .where(ilike(boardStoryCandidates.canonicalTitle, `%${contains}%`))
    .limit(20);

  if (rows.length === 0) {
    console.log("No matching stories.");
    return;
  }

  for (const row of rows) {
    await scoreStory(row.id);
  }

  const rescored = await db
    .select()
    .from(boardStoryCandidates)
    .where(ilike(boardStoryCandidates.canonicalTitle, `%${contains}%`))
    .limit(20);

  for (const row of rescored) {
    const scoreJson = asRecord(row.scoreJson);
    const ai = asRecord(scoreJson.aiBoardAssessment);
    console.log(
      JSON.stringify(
        {
          id: row.id,
          title: row.canonicalTitle,
          final: row.surgeScore,
          visibility: scoreJson.boardVisibilityScore ?? null,
          moonFit: ai.moonFitScore ?? null,
          controversy: ai.controversyScore ?? null,
          explanation: ai.explanation ?? null,
        },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
