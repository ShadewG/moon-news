import "server-only";

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { scriptAgentRequestSchema } from "@/lib/script-agent";
import { getDb } from "@/server/db/client";
import { clipLibrary, transcriptCache } from "@/server/db/schema";
import { generatePlanResearchStageOutput } from "@/server/services/script-agent";
import {
  createAnthropicJson,
  getAnthropicPlanningModel,
} from "@/server/services/script-lab";

const DEFAULT_CLIP_ID = "603b9cfb-1072-42be-bb06-2f0e476c22f7";

const transcriptSummarySchema = z.object({
  primaryAngle: z.string().trim().min(1),
  hook: z.string().trim().min(1),
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        purpose: z.string().trim().min(1),
        keyPoints: z.array(z.string().trim().min(1)).min(1).max(5),
      })
    )
    .min(4)
    .max(8),
  mustCoverPoints: z.array(z.string().trim().min(1)).min(4).max(12),
});

const alignmentSchema = z.object({
  overlapScore: z.number().int().min(1).max(10),
  angleAlignment: z.string().trim().min(1),
  structuralAlignment: z.string().trim().min(1),
  naturallyCoveredPoints: z.array(z.string().trim().min(1)).min(1).max(12),
  missingPoints: z.array(z.string().trim().min(1)).max(12),
  forcedPoints: z.array(z.string().trim().min(1)).max(12),
  verdict: z.string().trim().min(1),
});

function buildEvaluationSeed(title: string) {
  return [
    `Headline-only evaluation run for: ${title}.`,
    "Do not assume any hidden dossier. The planning stack should discover the angle from the headline and broad research.",
    "This evaluation intentionally starts with minimal input so we can see whether the Moon-style planning stages naturally converge on the same structure Moon used in the actual video.",
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
      transcript: transcriptCache.fullText,
    })
    .from(clipLibrary)
    .innerJoin(transcriptCache, eq(transcriptCache.clipId, clipLibrary.id))
    .where(eq(clipLibrary.id, clipId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!row) {
    throw new Error(`Clip with transcript not found: ${clipId}`);
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

  const transcriptSummary = await createAnthropicJson({
    schema: transcriptSummarySchema,
    model: getAnthropicPlanningModel(),
    system:
      "You are summarizing the actual structure of a finished Moon documentary transcript so it can be compared with a newly generated planning output. Return JSON only.",
    user: `Moon video title:
${row.title}

Transcript:
${row.transcript.slice(0, 45000)}

Return JSON with:
{
  "primaryAngle": "",
  "hook": "",
  "sections": [
    {
      "title": "",
      "purpose": "",
      "keyPoints": []
    }
  ],
  "mustCoverPoints": []
}`,
    temperature: 0.2,
    maxTokens: 2600,
  });

  const alignment = await createAnthropicJson({
    schema: alignmentSchema,
    model: getAnthropicPlanningModel(),
    system:
      "You are evaluating whether a new Moon script planning stack naturally converged on the same core structure and points as an actual Moon video on the same topic. Be strict and concrete. Return JSON only.",
    user: `Planning output:
${JSON.stringify(
      {
        broadResearch: plan.broadResearch,
        researchStrategy: plan.researchStrategy,
        sectionQueryPlanning: plan.sectionQueryPlanning,
      },
      null,
      2
    )}

Actual Moon transcript structure:
${JSON.stringify(transcriptSummary, null, 2)}

Judge whether the planning result naturally reaches the same core points, structure, and angle without being pushed there.

Return JSON with:
{
  "overlapScore": 1,
  "angleAlignment": "",
  "structuralAlignment": "",
  "naturallyCoveredPoints": [],
  "missingPoints": [],
  "forcedPoints": [],
  "verdict": ""
}`,
    temperature: 0.2,
    maxTokens: 2200,
  });

  const report = [
    `# Script-Agent Planning Evaluation`,
    ``,
    `- Clip ID: \`${row.clipId}\``,
    `- Title: ${row.title}`,
    `- Source URL: ${row.sourceUrl}`,
    `- Broad research model: ${plan.broadResearchModel}`,
    `- Research strategy model: ${plan.researchStrategyModel}`,
    `- Section query planner model: ${plan.sectionQueryPlanningModel}`,
    ``,
    `## Generated Angle`,
    ``,
    `- Primary angle: ${plan.researchStrategy.primaryAngle}`,
    `- Hook idea: ${plan.researchStrategy.hookIdea}`,
    `- Story type: ${plan.researchStrategy.storyType}`,
    ``,
    `## Generated Sections`,
    ``,
    ...plan.researchStrategy.videoStructure.map(
      (section, index) =>
        `${index + 1}. ${section.title}\n   - purpose: ${section.purpose}\n   - why it matters: ${section.whyItMatters}`
    ),
    ``,
    `## Actual Moon Transcript Structure`,
    ``,
    `- Primary angle: ${transcriptSummary.primaryAngle}`,
    `- Hook: ${transcriptSummary.hook}`,
    ``,
    ...transcriptSummary.sections.map(
      (section, index) =>
        `${index + 1}. ${section.title}\n   - purpose: ${section.purpose}\n   - key points: ${section.keyPoints.join(" | ")}`
    ),
    ``,
    `## Alignment Verdict`,
    ``,
    `- Overlap score: ${alignment.overlapScore}/10`,
    `- Angle alignment: ${alignment.angleAlignment}`,
    `- Structural alignment: ${alignment.structuralAlignment}`,
    `- Naturally covered points: ${alignment.naturallyCoveredPoints.join(" | ") || "none"}`,
    `- Missing points: ${alignment.missingPoints.join(" | ") || "none"}`,
    `- Forced points: ${alignment.forcedPoints.join(" | ") || "none"}`,
    `- Verdict: ${alignment.verdict}`,
    ``,
    `## Section Query Planning`,
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
    "",
  ].join("\n");

  const reportPath =
    outArg ||
    path.resolve(
      process.cwd(),
      "research",
      `planning-eval-${row.title
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
