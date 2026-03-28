import "server-only";

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { asc, desc, eq } from "drizzle-orm";

import { scriptAgentRequestSchema } from "@/lib/script-agent";
import { getDb } from "@/server/db/client";
import {
  scriptAgentQuotes,
  scriptAgentSources,
  scriptAgentStages,
} from "@/server/db/schema";
import { runScriptAgentResearchStagesForEvaluation } from "@/server/services/script-agent";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildEvaluationSeed(title: string) {
  return [
    `Headline-only evaluation run for: ${title}.`,
    "Do not assume any hidden dossier. The research stack should discover the angle, sources, and evidence from the headline and its own searches.",
    "The target output is a strong Moon documentary research packet with a usable outline and direct transcript receipts where possible.",
  ].join(" ");
}

async function main() {
  const slugArg = process.argv[2]?.trim();
  const titleArg = process.argv[3]?.trim();

  if (!slugArg || !titleArg) {
    throw new Error("Usage: evaluate-headline-research.ts <slug> <story title>");
  }

  const slug = slugify(slugArg);
  const title = titleArg;
  const outPath = path.resolve(process.cwd(), "research", `headline-eval-${slug}.json`);
  const db = getDb();

  const input = scriptAgentRequestSchema.parse({
    storyTitle: title,
    researchText: buildEvaluationSeed(title),
    objective: "",
    preferredAngle: "",
    notes: "",
    researchDepth: "deep",
    targetRuntimeMinutes: 12,
  });

  const evaluation = await runScriptAgentResearchStagesForEvaluation(input);

  const [stageRows, sourceRows, quoteRows] = await Promise.all([
    db
      .select()
      .from(scriptAgentStages)
      .where(eq(scriptAgentStages.runId, evaluation.runId))
      .orderBy(asc(scriptAgentStages.stageOrder)),
    db
      .select({
        id: scriptAgentSources.id,
        stageKey: scriptAgentSources.stageKey,
        sourceKind: scriptAgentSources.sourceKind,
        providerName: scriptAgentSources.providerName,
        title: scriptAgentSources.title,
        url: scriptAgentSources.url,
        snippet: scriptAgentSources.snippet,
        contentStatus: scriptAgentSources.contentStatus,
        transcriptStatus: scriptAgentSources.transcriptStatus,
        metadataJson: scriptAgentSources.metadataJson,
        createdAt: scriptAgentSources.createdAt,
      })
      .from(scriptAgentSources)
      .where(eq(scriptAgentSources.runId, evaluation.runId))
      .orderBy(desc(scriptAgentSources.createdAt)),
    db
      .select({
        sourceId: scriptAgentQuotes.sourceId,
        sourceLabel: scriptAgentQuotes.sourceLabel,
        sourceUrl: scriptAgentQuotes.sourceUrl,
        quoteText: scriptAgentQuotes.quoteText,
        speaker: scriptAgentQuotes.speaker,
        context: scriptAgentQuotes.context,
        startMs: scriptAgentQuotes.startMs,
        relevanceScore: scriptAgentQuotes.relevanceScore,
        metadataJson: scriptAgentQuotes.metadataJson,
        createdAt: scriptAgentQuotes.createdAt,
      })
      .from(scriptAgentQuotes)
      .where(eq(scriptAgentQuotes.runId, evaluation.runId))
      .orderBy(desc(scriptAgentQuotes.relevanceScore), desc(scriptAgentQuotes.createdAt)),
  ]);

  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const transcriptQuotes = quoteRows
    .filter((quote) => typeof quote.startMs === "number")
    .map((quote) => ({
      ...quote,
      source: quote.sourceId ? sourceById.get(quote.sourceId) ?? null : null,
    }));
  const documentQuotes = quoteRows
    .filter((quote) => typeof quote.startMs !== "number")
    .map((quote) => ({
      ...quote,
      source: quote.sourceId ? sourceById.get(quote.sourceId) ?? null : null,
    }));

  const transcriptSources = sourceRows.filter(
    (source) =>
      source.sourceKind === "library_clip" ||
      source.sourceKind === "video" ||
      source.sourceKind === "social_post"
  );

  const report = {
    slug,
    title,
    generatedAt: new Date().toISOString(),
    evaluationRunId: evaluation.runId,
    request: input,
    planResearchStage: evaluation.planResearchStage,
    discoverSourcesStage: evaluation.discoverSourcesStage,
    ingestSourcesStage: evaluation.ingestSourcesStage,
    extractEvidenceStage: evaluation.extractEvidenceStage,
    synthesizeResearchStage: evaluation.synthesizeResearchStage,
    outlineStage: evaluation.outlineStage,
    followupResearchStage: evaluation.followupResearchStage,
    metrics: {
      totalSources: sourceRows.length,
      transcriptSources: transcriptSources.length,
      transcriptSourcesComplete: transcriptSources.filter(
        (source) => source.transcriptStatus === "complete"
      ).length,
      transcriptSourcesPending: transcriptSources.filter(
        (source) => source.transcriptStatus !== "complete"
      ).length,
      transcriptQuoteCount: transcriptQuotes.length,
      documentQuoteCount: documentQuotes.length,
    },
    stages: stageRows,
    sources: sourceRows.slice(0, 80),
    transcriptSources: transcriptSources.slice(0, 40),
    transcriptQuotes: transcriptQuotes.slice(0, 40),
    documentQuotes: documentQuotes.slice(0, 40),
  };

  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(outPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
