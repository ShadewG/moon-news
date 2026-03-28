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

  const plan = await generatePlanResearchStageOutput(input);

  const report = [
    `# Plan Research Preview`,
    ``,
    `- Clip ID: \`${row.clipId}\``,
    `- Title: ${row.title}`,
    `- Source URL: ${row.sourceUrl}`,
    `- Planning mode: ${plan.planningMode}`,
    `- Broad research provider: ${plan.broadResearchProvider}`,
    `- Broad research model: ${plan.broadResearchModel}`,
    `- Research strategy model: ${plan.researchStrategyModel}`,
    `- Section query planning model: ${plan.sectionQueryPlanningModel}`,
    ``,
    `## Broad Research`,
    ``,
    `- Overview: ${plan.broadResearch.factualOverview}`,
    `- System: ${plan.broadResearch.broaderSystem}`,
    `- Tensions: ${plan.broadResearch.tensions.join(" | ") || "none"}`,
    `- Open questions: ${plan.broadResearch.openQuestions.join(" | ") || "none"}`,
    ``,
    `## Strategy`,
    ``,
    `- Primary angle: ${plan.researchStrategy.primaryAngle}`,
    `- Hook: ${plan.researchStrategy.hookIdea}`,
    `- Story type: ${plan.researchStrategy.storyType}`,
    `- Risks: ${plan.researchStrategy.risks.join(" | ") || "none"}`,
    `- Skip: ${plan.researchStrategy.skip.join(" | ") || "none"}`,
    ``,
    `## Video Structure`,
    ``,
    ...plan.researchStrategy.videoStructure.map(
      (section, index) =>
        `${index + 1}. ${section.title}\n   - purpose: ${section.purpose}\n   - why it matters: ${section.whyItMatters}\n   - evidence needed: ${section.evidenceNeeded.join(" | ") || "none"}\n   - search priorities: ${section.searchPriorities.join(" | ") || "none"}\n   - target words: ${section.targetWordCount}`
    ),
    ``,
    `## Global Queries`,
    ``,
    ...plan.sectionQueryPlanning.globalQueries.map(
      (query) =>
        `- [${query.searchMode}] ${query.label}: ${query.query}\n  - objective: ${query.objective}`
    ),
    ``,
    `## Section Queries`,
    ``,
    ...plan.sectionQueryPlanning.sectionQueries.map((section) => {
      const match =
        plan.researchStrategy.videoStructure.find((item) => item.sectionId === section.sectionId)
          ?.title ?? section.sectionId;
      return [
        `- ${match}`,
        ...section.articleQueries.map((query) => `  - article: ${query}`),
        ...section.videoQueries.map((query) => `  - video: ${query}`),
        ...section.socialQueries.map((query) => `  - social: ${query}`),
        ...section.podcastQueries.map((query) => `  - podcast: ${query}`),
      ].join("\n");
    }),
    ``,
    `## Initial Research Beams`,
    ``,
    ...plan.researchPlan.globalBeams.map(
      (beam) =>
        `- [${beam.searchMode}] ${beam.label}: ${beam.query}\n  - objective: ${beam.objective}`
    ),
    "",
  ].join("\n");

  const reportPath =
    outArg ||
    path.resolve(
      process.cwd(),
      "research",
      `planning-preview-${row.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}.md`
    );

  await writeFile(reportPath, report, "utf8");
  console.log(reportPath);
  console.log(report);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
