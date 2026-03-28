import "server-only";

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { asc, desc, eq, sql } from "drizzle-orm";

import { scriptAgentRequestSchema } from "@/lib/script-agent";
import { getDb } from "@/server/db/client";
import {
  clipLibrary,
  scriptAgentQuotes,
  scriptAgentSources,
  scriptAgentStages,
} from "@/server/db/schema";
import { runScriptAgentResearchStagesForEvaluation } from "@/server/services/script-agent";

const DEFAULT_CLIP_ID = "603b9cfb-1072-42be-bb06-2f0e476c22f7";

function buildEvaluationSeed(title: string) {
  return [
    `Headline-only evaluation run for: ${title}.`,
    "Do not assume any hidden dossier. The research stack should discover the angle and evidence from the headline and its own searches.",
    "The target output is a strong Moon documentary research packet, not a generic explainer.",
  ].join(" ");
}

function formatDurationMs(startedAt: Date | null, completedAt: Date | null) {
  if (!startedAt || !completedAt) {
    return "n/a";
  }

  const ms = completedAt.getTime() - startedAt.getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  const clipId = process.argv[2] ?? DEFAULT_CLIP_ID;
  const outArg = process.argv[3] ?? "";
  const db = getDb();

  const clip = await db
    .select({
      clipId: clipLibrary.id,
      title: clipLibrary.title,
      sourceUrl: clipLibrary.sourceUrl,
    })
    .from(clipLibrary)
    .where(eq(clipLibrary.id, clipId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!clip) {
    throw new Error(`Clip not found: ${clipId}`);
  }

  const input = scriptAgentRequestSchema.parse({
    storyTitle: clip.title,
    researchText: buildEvaluationSeed(clip.title),
    objective: "",
    preferredAngle: "",
    notes: "",
    researchDepth: "deep",
    targetRuntimeMinutes: 12,
  });

  const evaluation = await runScriptAgentResearchStagesForEvaluation(input);

  const [stageRows, sourceRows, quoteRows, sourceCounts] = await Promise.all([
    db
      .select()
      .from(scriptAgentStages)
      .where(eq(scriptAgentStages.runId, evaluation.runId))
      .orderBy(asc(scriptAgentStages.stageOrder)),
    db
      .select({
        stageKey: scriptAgentSources.stageKey,
        sourceKind: scriptAgentSources.sourceKind,
        providerName: scriptAgentSources.providerName,
        title: scriptAgentSources.title,
        url: scriptAgentSources.url,
        contentStatus: scriptAgentSources.contentStatus,
        transcriptStatus: scriptAgentSources.transcriptStatus,
        createdAt: scriptAgentSources.createdAt,
      })
      .from(scriptAgentSources)
      .where(eq(scriptAgentSources.runId, evaluation.runId))
      .orderBy(desc(scriptAgentSources.createdAt))
      .limit(25),
    db
      .select({
        stageKey: scriptAgentSources.stageKey,
        sourceLabel: scriptAgentQuotes.sourceLabel,
        sourceUrl: scriptAgentQuotes.sourceUrl,
        quoteText: scriptAgentQuotes.quoteText,
        startMs: scriptAgentQuotes.startMs,
        relevanceScore: scriptAgentQuotes.relevanceScore,
        createdAt: scriptAgentQuotes.createdAt,
      })
      .from(scriptAgentQuotes)
      .leftJoin(scriptAgentSources, eq(scriptAgentSources.id, scriptAgentQuotes.sourceId))
      .where(eq(scriptAgentQuotes.runId, evaluation.runId))
      .orderBy(desc(scriptAgentQuotes.relevanceScore), desc(scriptAgentQuotes.createdAt))
      .limit(20),
    db
      .select({
        stageKey: scriptAgentSources.stageKey,
        sourceKind: scriptAgentSources.sourceKind,
        count: sql<number>`count(*)::int`,
      })
      .from(scriptAgentSources)
      .where(eq(scriptAgentSources.runId, evaluation.runId))
      .groupBy(scriptAgentSources.stageKey, scriptAgentSources.sourceKind)
      .orderBy(asc(scriptAgentSources.stageKey), asc(scriptAgentSources.sourceKind)),
  ]);

  const report = [
    `# Script-Agent Research Evaluation`,
    ``,
    `- Clip ID: \`${clip.clipId}\``,
    `- Title: ${clip.title}`,
    `- Source URL: ${clip.sourceUrl}`,
    `- Evaluation run ID: \`${evaluation.runId}\``,
    ``,
    `## Planning Result`,
    ``,
    `- Broad research provider: ${evaluation.planResearchStage.broadResearchProvider}`,
    `- Broad research model: ${evaluation.planResearchStage.broadResearchModel}`,
    `- Research strategy model: ${evaluation.planResearchStage.researchStrategyModel}`,
    `- Section query planning model: ${evaluation.planResearchStage.sectionQueryPlanningModel}`,
    `- Primary angle: ${evaluation.planResearchStage.researchStrategy.primaryAngle}`,
    `- Hook idea: ${evaluation.planResearchStage.researchStrategy.hookIdea}`,
    ``,
    `## Stage Outputs`,
    ``,
    ...stageRows.map(
      (stage) =>
        `- ${stage.stageKey}: ${stage.status} (${formatDurationMs(stage.startedAt, stage.completedAt)})`
    ),
    ``,
    `## Stage Metrics`,
    ``,
    `- discover_sources: beams=${evaluation.discoverSourcesStage.beamCount}, searched_beams=${evaluation.discoverSourcesStage.searchedBeamCount}, searched_results=${evaluation.discoverSourcesStage.searchedResultCount}, inserted_sources=${evaluation.discoverSourcesStage.insertedSourceCount}, inserted_quotes=${evaluation.discoverSourcesStage.insertedQuoteCount}, promoted_urls=${evaluation.discoverSourcesStage.promotedUrlCount}`,
    `- ingest_sources: processed=${evaluation.ingestSourcesStage.processedDocumentCount}, completed=${evaluation.ingestSourcesStage.completedDocumentCount}, transcript_checks=${evaluation.ingestSourcesStage.transcriptChecks}, transcript_completed=${evaluation.ingestSourcesStage.transcriptCompleted}`,
    `- extract_evidence: added_research=${evaluation.extractEvidenceStage.addedResearchQuotes}, added_document=${evaluation.extractEvidenceStage.addedDocumentQuotes}, added_transcript=${evaluation.extractEvidenceStage.addedTranscriptQuotes}, total_quotes=${evaluation.extractEvidenceStage.totalQuotes}`,
    `- synthesize_research thesis: ${evaluation.synthesizeResearchStage.thesis}`,
    `- build_outline sections: ${evaluation.outlineStage.sections.length}`,
    `- followup_research: beams=${evaluation.followupResearchStage.beamCount}, searched_beams=${evaluation.followupResearchStage.searchedBeamCount}, searched_results=${evaluation.followupResearchStage.searchedResultCount}, inserted_sources=${evaluation.followupResearchStage.insertedSourceCount}, completed_docs=${evaluation.followupResearchStage.completedDocumentCount}, transcript_completed=${evaluation.followupResearchStage.transcriptCompleted}, added_document_quotes=${evaluation.followupResearchStage.addedDocumentQuotes}, added_transcript_quotes=${evaluation.followupResearchStage.addedTranscriptQuotes}, total_quotes=${evaluation.followupResearchStage.totalQuotes}`,
    ``,
    `## Source Counts`,
    ``,
    ...sourceCounts.map(
      (row) =>
        `- ${row.stageKey ?? "none"} / ${row.sourceKind}: ${row.count}`
    ),
    ``,
    `## Sample Sources`,
    ``,
    ...sourceRows.map(
      (row) =>
        `- [${row.stageKey ?? "none"}] [${row.sourceKind}] [${row.providerName}] ${row.title}\n  - content=${row.contentStatus}, transcript=${row.transcriptStatus}\n  - ${row.url ?? "no url"}`
    ),
    ``,
    `## Sample Quotes`,
    ``,
    ...quoteRows.map(
      (row) =>
        `- [${row.stageKey ?? "none"}] ${row.sourceLabel} (${row.relevanceScore})${typeof row.startMs === "number" ? ` @ ${row.startMs}ms` : ""}\n  - ${row.quoteText}\n  - ${row.sourceUrl ?? "no url"}`
    ),
    "",
  ].join("\n");

  const reportPath =
    outArg ||
    path.resolve(
      process.cwd(),
      "research",
      `research-eval-${clip.title
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
