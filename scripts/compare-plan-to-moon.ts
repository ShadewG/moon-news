import "server-only";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { clipLibrary, transcriptCache } from "@/server/db/schema";
import {
  createAnthropicJson,
  getAnthropicPlanningModel,
} from "@/server/services/script-lab";

const DEFAULT_CLIP_ID = "603b9cfb-1072-42be-bb06-2f0e476c22f7";
const DEFAULT_PLAN_PATH =
  "research/debug-plan-why-the-cia-failed-to-assassinate-julian-assange.json";

const transcriptSummarySchema = z.object({
  primaryAngle: z.string().trim().min(1),
  hook: z.string().trim().min(1),
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        purpose: z.string().trim().min(1),
        keyPoints: z.array(z.string().trim().min(1)).min(1).max(6),
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

async function main() {
  const clipId = process.argv[2] ?? DEFAULT_CLIP_ID;
  const planPathArg = process.argv[3] ?? DEFAULT_PLAN_PATH;
  const outArg = process.argv[4] ?? "";
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

  const resolvedPlanPath = path.resolve(process.cwd(), planPathArg);
  const plan = JSON.parse(await readFile(resolvedPlanPath, "utf8")) as Record<string, unknown>;

  const transcriptSummary = await createAnthropicJson({
    schema: transcriptSummarySchema,
    model: getAnthropicPlanningModel(),
    system:
      "You are summarizing the actual structure of a finished Moon documentary transcript so it can be compared with a generated planning output. Return JSON only.",
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

Scoring rules:
- 10 means near-match: no material missing points, no thesis-level divergence, and no major forced sections.
- 8 is the ceiling if there are any material missing points or a noticeable thesis/resolution divergence.
- 6 is the ceiling if three or more material points are missing, or if the plan forces a major section the actual Moon video does not need.
- 4 or below if the chronological backbone or central angle materially diverges.
- The numeric score must match your written missingPoints and forcedPoints. Do not hand out a high score and then list multiple major misses.

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
    `# Plan vs Moon Transcript`,
    ``,
    `- Clip ID: \`${row.clipId}\``,
    `- Title: ${row.title}`,
    `- Source URL: ${row.sourceUrl}`,
    `- Plan JSON: ${resolvedPlanPath}`,
    ``,
    `## Generated Angle`,
    ``,
    `- Primary angle: ${String((plan.researchStrategy as Record<string, unknown>).primaryAngle ?? "")}`,
    `- Hook idea: ${String((plan.researchStrategy as Record<string, unknown>).hookIdea ?? "")}`,
    `- Story type: ${String((plan.researchStrategy as Record<string, unknown>).storyType ?? "")}`,
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
    "",
  ].join("\n");

  const reportPath =
    outArg ||
    path.resolve(
      process.cwd(),
      "research",
      `plan-vs-moon-${row.title
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
