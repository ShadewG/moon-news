import "server-only";

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { scriptAgentRequestSchema } from "@/lib/script-agent";
import { getDb } from "@/server/db/client";
import { clipLibrary } from "@/server/db/schema";
import { generatePlanResearchStageOutput } from "@/server/services/script-agent";

const DEFAULT_CLIP_ID = "603b9cfb-1072-42be-bb06-2f0e476c22f7";

function buildEvaluationSeed(title: string) {
  return [
    `Headline-only evaluation run for: ${title}.`,
    "Do not assume any hidden dossier. The planning stack should discover the angle from the headline and broad research.",
    "The target output is a strong Moon documentary plan, not a generic explainer.",
  ].join(" ");
}

function elapsedMs(start: number) {
  return Date.now() - start;
}

async function main() {
  const clipId = process.argv[2] ?? DEFAULT_CLIP_ID;
  const outArg = process.argv[3] ?? "";
  const db = getDb();

  const row = await db
    .select({
      clipId: clipLibrary.id,
      title: clipLibrary.title,
      sourceUrl: clipLibrary.sourceUrl,
    })
    .from(clipLibrary)
    .where(eq(clipLibrary.id, clipId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!row) {
    throw new Error(`Clip not found: ${clipId}`);
  }

  const input = scriptAgentRequestSchema.parse({
    storyTitle: row.title,
    researchText: buildEvaluationSeed(row.title),
    objective: "",
    preferredAngle: "",
    notes: "",
    researchDepth: "deep",
    targetRuntimeMinutes: 12,
  });

  const start = Date.now();
  console.error(`[debug-plan] plan_research start: ${row.title}`);
  const planStage = await generatePlanResearchStageOutput(input);
  console.error(
    `[debug-plan] plan_research complete in ${elapsedMs(start)}ms via ${planStage.broadResearchProvider} -> ${planStage.researchStrategyModel} -> ${planStage.sectionQueryPlanningModel}`
  );

  const report = {
    clipId: row.clipId,
    title: row.title,
    sourceUrl: row.sourceUrl,
    broadResearchProvider: planStage.broadResearchProvider,
    broadResearchModel: planStage.broadResearchModel,
    broadResearch: planStage.broadResearch,
    broadResearchMemo: planStage.broadResearchMemo,
    planningBeats: planStage.planningBeats,
    researchStrategyModel: planStage.researchStrategyModel,
    researchStrategy: planStage.researchStrategy,
    sectionQueryPlanningModel: planStage.sectionQueryPlanningModel,
    sectionQueryPlanning: planStage.sectionQueryPlanning,
  };

  const reportPath =
    outArg ||
    path.resolve(
      process.cwd(),
      "research",
      `debug-plan-${row.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}.json`
    );

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(reportPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
