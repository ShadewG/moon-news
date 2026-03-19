import "server-only";

import { tasks } from "@trigger.dev/sdk/v3";
import { and, asc, desc, eq } from "drizzle-orm";

import {
  type ScriptAgentRequest,
  type ScriptAgentRun,
  type ScriptAgentStageKey,
  scriptAgentRunSchema,
} from "@/lib/script-agent";
import { isTriggerConfigured } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import {
  scriptAgentClaims,
  scriptAgentQuotes,
  scriptAgentRuns,
  scriptAgentSources,
  scriptAgentStages,
  transcriptCache,
} from "@/server/db/schema";
import { extractContent } from "@/server/services/board/content-extractor";
import { searchNewsStory } from "@/server/services/board/news-search";
import { generateScriptLabOutputs } from "@/server/services/script-lab";
import { searchTopic } from "@/server/services/topic-search";

export const SCRIPT_AGENT_TASK_ID = "run-script-agent";

const SCRIPT_AGENT_STAGE_ORDER: ScriptAgentStageKey[] = [
  "discover_sources",
  "ingest_sources",
  "extract_evidence",
  "synthesize_research",
  "build_outline",
  "build_storyboard",
  "draft_script",
  "critique_script",
  "analyze_retention",
  "finalize_script",
];

function serializeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function extractDirectQuotes(text: string) {
  const pattern = /["“]([^"\n”]{24,280})["”]/g;
  const seen = new Set<string>();
  const quotes: Array<{
    quoteText: string;
    context: string;
  }> = [];

  for (const block of text.split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean)) {
    for (const match of block.matchAll(pattern)) {
      const quoteText = (match[1] ?? "").replace(/\s+/g, " ").trim();
      if (quoteText.length < 24) {
        continue;
      }
      const key = quoteText.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      quotes.push({
        quoteText,
        context: block.slice(0, 260),
      });
    }
  }

  return quotes.slice(0, 8);
}

function mapResearchDepthToSearchMode(depth: ScriptAgentRequest["researchDepth"]) {
  return depth === "quick" ? "quick" : "full";
}

function trimToLength(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function buildCompiledResearchText(args: {
  input: ScriptAgentRequest;
  articleSources: Array<{
    title: string;
    url: string | null;
    snippet: string | null;
    contentJson: unknown;
  }>;
  quoteRows: Array<{
    sourceLabel: string;
    sourceUrl: string | null;
    quoteText: string;
    speaker: string | null;
    context: string | null;
  }>;
}) {
  const sections = [
    "Primary research dossier:",
    args.input.researchText.trim(),
  ];

  if (args.articleSources.length > 0) {
    sections.push("", "Discovered article evidence:");

    for (const source of args.articleSources.slice(0, 6)) {
      const content = source.contentJson as
        | { title?: string | null; content?: string | null; siteName?: string | null; publishedAt?: string | null }
        | null;

      sections.push(
        [
          `Source: ${source.title}`,
          source.url ? `URL: ${source.url}` : null,
          source.snippet ? `Snippet: ${source.snippet}` : null,
          content?.siteName ? `Site: ${content.siteName}` : null,
          content?.publishedAt ? `Published: ${content.publishedAt}` : null,
          content?.content ? `Extract: ${trimToLength(content.content, 2200)}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }

  if (args.quoteRows.length > 0) {
    sections.push("", "Quote bank:");

    for (const quote of args.quoteRows.slice(0, 12)) {
      sections.push(
        [
          `Source: ${quote.sourceLabel}`,
          quote.sourceUrl ? `URL: ${quote.sourceUrl}` : null,
          quote.speaker ? `Speaker: ${quote.speaker}` : null,
          `Quote: "${quote.quoteText}"`,
          quote.context ? `Context: ${quote.context}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }

  return trimToLength(sections.join("\n\n"), 48000);
}

function mergeNotes(input: ScriptAgentRequest) {
  return [input.objective, input.preferredAngle, input.notes]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n");
}

function serializeRunRecord(args: {
  run: typeof scriptAgentRuns.$inferSelect;
  stages: Array<typeof scriptAgentStages.$inferSelect>;
  sources: Array<typeof scriptAgentSources.$inferSelect>;
  quotes: Array<typeof scriptAgentQuotes.$inferSelect>;
  claims: Array<typeof scriptAgentClaims.$inferSelect>;
}): ScriptAgentRun {
  return scriptAgentRunSchema.parse({
    id: args.run.id,
    storyTitle: args.run.storyTitle,
    status: args.run.status,
    currentStage: args.run.currentStage,
    researchDepth: args.run.researchDepth,
    triggerRunId: args.run.triggerRunId,
    request: args.run.requestJson,
    result: args.run.resultJson ?? null,
    errorText: args.run.errorText,
    startedAt: serializeDate(args.run.startedAt),
    completedAt: serializeDate(args.run.completedAt),
    createdAt: args.run.createdAt.toISOString(),
    updatedAt: args.run.updatedAt.toISOString(),
    stages: args.stages.map((stage) => ({
      id: stage.id,
      stageKey: stage.stageKey,
      stageOrder: stage.stageOrder,
      status: stage.status,
      inputJson: stage.inputJson ?? null,
      outputJson: stage.outputJson ?? null,
      errorText: stage.errorText,
      startedAt: serializeDate(stage.startedAt),
      completedAt: serializeDate(stage.completedAt),
      updatedAt: stage.updatedAt.toISOString(),
    })),
    sources: args.sources.map((source) => ({
      id: source.id,
      sourceKind: source.sourceKind,
      providerName: source.providerName,
      title: source.title,
      url: source.url,
      snippet: source.snippet,
      publishedAt: source.publishedAt,
      clipId: source.clipId,
      contentStatus: source.contentStatus,
      transcriptStatus: source.transcriptStatus,
      contentJson: source.contentJson ?? null,
      metadataJson: source.metadataJson ?? null,
    })),
    quotes: args.quotes.map((quote) => ({
      id: quote.id,
      sourceId: quote.sourceId,
      sourceLabel: quote.sourceLabel,
      sourceUrl: quote.sourceUrl,
      quoteText: quote.quoteText,
      speaker: quote.speaker,
      context: quote.context,
      relevanceScore: quote.relevanceScore,
      startMs: quote.startMs,
      endMs: quote.endMs,
      metadataJson: quote.metadataJson ?? null,
    })),
    claims: args.claims.map((claim) => ({
      id: claim.id,
      claimText: claim.claimText,
      supportLevel: claim.supportLevel,
      riskLevel: claim.riskLevel,
      evidenceRefsJson: claim.evidenceRefsJson,
      notes: claim.notes,
    })),
  });
}

async function updateStage(
  runId: string,
  stageKey: ScriptAgentStageKey,
  values: Partial<typeof scriptAgentStages.$inferInsert>
) {
  const db = getDb();
  await db
    .update(scriptAgentStages)
    .set({
      ...values,
      updatedAt: new Date(),
    })
    .where(and(eq(scriptAgentStages.runId, runId), eq(scriptAgentStages.stageKey, stageKey)));
}

async function markStageRunning(runId: string, stageKey: ScriptAgentStageKey, inputJson?: unknown) {
  await updateStage(runId, stageKey, {
    status: "running",
    inputJson: inputJson ?? null,
    errorText: null,
    startedAt: new Date(),
    completedAt: null,
  });

  const db = getDb();
  await db
    .update(scriptAgentRuns)
    .set({
      status: "running",
      currentStage: stageKey,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(scriptAgentRuns.id, runId));
}

async function markStageComplete(runId: string, stageKey: ScriptAgentStageKey, outputJson?: unknown) {
  await updateStage(runId, stageKey, {
    status: "complete",
    outputJson: outputJson ?? null,
    completedAt: new Date(),
  });
}

async function markStageFailed(runId: string, stageKey: ScriptAgentStageKey, errorText: string) {
  await updateStage(runId, stageKey, {
    status: "failed",
    errorText,
    completedAt: new Date(),
  });
}

async function runStage<T>(
  runId: string,
  stageKey: ScriptAgentStageKey,
  inputJson: unknown,
  fn: () => Promise<T>
) {
  await markStageRunning(runId, stageKey, inputJson);

  try {
    const output = await fn();
    await markStageComplete(runId, stageKey, output);
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown stage error";
    await markStageFailed(runId, stageKey, message);
    throw error;
  }
}

async function discoverSourcesForRun(runId: string, input: ScriptAgentRequest) {
  const db = getDb();
  const [topicResult, newsResults] = await Promise.all([
    searchTopic(input.storyTitle).catch(() => null),
    searchNewsStory(input.storyTitle, mapResearchDepthToSearchMode(input.researchDepth)).catch(() => []),
  ]);

  await db.insert(scriptAgentSources).values({
    runId,
    stageKey: "discover_sources",
    sourceKind: "research_dossier",
    providerName: "internal",
    title: "Research dossier",
    url: null,
    snippet: trimToLength(input.researchText, 500),
    contentStatus: "complete",
    transcriptStatus: "complete",
    contentJson: {
      objective: input.objective,
      preferredAngle: input.preferredAngle,
      researchText: input.researchText,
    },
  });

  if (newsResults.length > 0) {
    const articleSourceRows: Array<typeof scriptAgentSources.$inferInsert> = newsResults
      .slice(0, input.researchDepth === "quick" ? 6 : 12)
      .map((result) => ({
        runId,
        stageKey: "discover_sources",
        sourceKind: (result.source === "reddit" ? "social_post" : "article") as "social_post" | "article",
        providerName: result.source,
        title: result.title || result.url,
        url: result.url,
        snippet: result.snippet,
        publishedAt: result.publishedAt,
        contentStatus: "pending" as const,
        transcriptStatus: "pending" as const,
        metadataJson: result,
      }));

    await db.insert(scriptAgentSources).values(
      articleSourceRows
    );
  }

  if (topicResult?.clips?.length) {
    const clipSourceRows: Array<typeof scriptAgentSources.$inferInsert> = topicResult.clips
      .slice(0, 10)
      .map((clip) => ({
        runId,
        stageKey: "discover_sources",
        sourceKind: clip.provider === "twitter" ? "social_post" : "library_clip",
        providerName: clip.provider,
        title: clip.title,
        url: clip.sourceUrl,
        snippet: clip.channelOrContributor,
        publishedAt: clip.uploadDate,
        clipId: clip.clipId,
        contentStatus: "pending",
        transcriptStatus: clip.provider === "youtube" ? "complete" : "pending",
        metadataJson: clip,
      }));

    await db.insert(scriptAgentSources).values(
      clipSourceRows
    );
  }

  if (topicResult?.quotes?.length) {
    const sourceRows = await db
      .select()
      .from(scriptAgentSources)
      .where(eq(scriptAgentSources.runId, runId));
    const byClipId = new Map<string, string>();
    for (const source of sourceRows) {
      if (source.clipId) {
        byClipId.set(source.clipId, source.id);
      }
    }

    await db.insert(scriptAgentQuotes).values(
      topicResult.quotes.slice(0, 12).map((quote) => {
        const clip = topicResult.clips.find((item) => item.externalId === quote.videoId);
        return {
          runId,
          sourceId: clip ? byClipId.get(clip.clipId) ?? null : null,
          sourceLabel: quote.videoTitle,
          sourceUrl: quote.sourceUrl,
          quoteText: quote.quoteText,
          speaker: quote.speaker,
          context: quote.context,
          relevanceScore: quote.relevanceScore,
          startMs: quote.startMs,
          endMs: quote.startMs + 10000,
          metadataJson: {
            provider: "youtube",
            externalId: quote.videoId,
          },
        };
      })
    );
  }

  return {
    articleCount: newsResults.length,
    clipCount: topicResult?.clips.length ?? 0,
    quoteCount: topicResult?.quotes.length ?? 0,
  };
}

async function ingestSourcesForRun(runId: string, input: ScriptAgentRequest) {
  const db = getDb();
  const sources = await db
    .select()
    .from(scriptAgentSources)
    .where(eq(scriptAgentSources.runId, runId))
    .orderBy(desc(scriptAgentSources.createdAt));

  const articleSources = sources
    .filter((source) => source.sourceKind === "article" && source.url)
    .slice(0, input.researchDepth === "quick" ? 3 : 6);

  let extractedCount = 0;

  for (const source of articleSources) {
    const extracted = await extractContent(source.url!);
    const status = extracted.content ? "complete" : "failed";
    if (status === "complete") {
      extractedCount += 1;
    }

    await db
      .update(scriptAgentSources)
      .set({
        contentStatus: status,
        contentJson: extracted,
        updatedAt: new Date(),
      })
      .where(eq(scriptAgentSources.id, source.id));
  }

  const transcriptSources = sources.filter((source) => source.clipId);
  if (transcriptSources.length > 0) {
    const transcripts = await db
      .select({
        clipId: transcriptCache.clipId,
      })
      .from(transcriptCache)
      .where(eq(transcriptCache.language, "en"));
    const transcriptIds = new Set(transcripts.map((row) => row.clipId));

    for (const source of transcriptSources) {
      await db
        .update(scriptAgentSources)
        .set({
          transcriptStatus: source.clipId && transcriptIds.has(source.clipId) ? "complete" : "pending",
          updatedAt: new Date(),
        })
        .where(eq(scriptAgentSources.id, source.id));
    }
  }

  return {
    articleSourcesProcessed: articleSources.length,
    articleSourcesExtracted: extractedCount,
  };
}

async function extractEvidenceForRun(runId: string, input: ScriptAgentRequest) {
  const db = getDb();
  const researchQuotes = extractDirectQuotes(input.researchText);

  if (researchQuotes.length > 0) {
    const dossierSource = await db
      .select()
      .from(scriptAgentSources)
      .where(and(eq(scriptAgentSources.runId, runId), eq(scriptAgentSources.sourceKind, "research_dossier")))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    await db.insert(scriptAgentQuotes).values(
      researchQuotes.map((quote) => ({
        runId,
        sourceId: dossierSource?.id ?? null,
        sourceLabel: "Research dossier",
        sourceUrl: null,
        quoteText: quote.quoteText,
        speaker: null,
        context: quote.context,
        relevanceScore: 60,
        startMs: null,
        endMs: null,
        metadataJson: {
          sourceType: "research_text",
        },
      }))
    );
  }

  const totalQuotes = await db
    .select()
    .from(scriptAgentQuotes)
    .where(eq(scriptAgentQuotes.runId, runId))
    .then((rows) => rows.length);

  return {
    addedResearchQuotes: researchQuotes.length,
    totalQuotes,
  };
}

async function synthesizeAndWriteRun(runId: string, input: ScriptAgentRequest) {
  const db = getDb();
  const [sourceRows, quoteRows] = await Promise.all([
    db
      .select()
      .from(scriptAgentSources)
      .where(eq(scriptAgentSources.runId, runId))
      .orderBy(desc(scriptAgentSources.createdAt)),
    db
      .select()
      .from(scriptAgentQuotes)
      .where(eq(scriptAgentQuotes.runId, runId))
      .orderBy(desc(scriptAgentQuotes.relevanceScore)),
  ]);

  const compiledResearchText = buildCompiledResearchText({
    input,
    articleSources: sourceRows
      .filter((source) => source.sourceKind === "article" && source.contentJson)
      .map((source) => ({
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        contentJson: source.contentJson,
      })),
    quoteRows: quoteRows.map((quote) => ({
      sourceLabel: quote.sourceLabel,
      sourceUrl: quote.sourceUrl,
      quoteText: quote.quoteText,
      speaker: quote.speaker,
      context: quote.context,
    })),
  });

  const enrichedInput: ScriptAgentRequest = {
    ...input,
    notes: mergeNotes(input),
    researchText: compiledResearchText,
  };

  const result = await generateScriptLabOutputs(enrichedInput);

  await db.delete(scriptAgentClaims).where(eq(scriptAgentClaims.runId, runId));
  if (result.stages?.research.keyClaims.length) {
    const evidenceRefs = result.stages.research.quoteEvidence
      .slice(0, 4)
      .map((quote) => quote.sourceTitle);

    await db.insert(scriptAgentClaims).values(
      result.stages.research.keyClaims.map((claimText) => ({
        runId,
        claimText,
        supportLevel: 75,
        riskLevel: result.stages?.research.riskyClaims.includes(claimText) ? 75 : 20,
        evidenceRefsJson: evidenceRefs,
        notes: result.stages?.research.riskyClaims.includes(claimText)
          ? "Flagged during research synthesis as a risky or high-context claim."
          : null,
      }))
    );
  }

  const stageOutputs: Partial<Record<ScriptAgentStageKey, unknown>> = {
    build_outline: result.stages?.outline ?? null,
    build_storyboard: result.stages?.storyboard ?? null,
    draft_script: result.variants.claude,
    critique_script: {
      editorialNotes: result.variants.claude.editorialNotes ?? [],
    },
    analyze_retention: result.stages?.retention ?? null,
    finalize_script: result.variants.final ?? result.variants.hybrid ?? null,
  };

  for (const [stageKey, outputJson] of Object.entries(stageOutputs) as Array<[ScriptAgentStageKey, unknown]>) {
    await markStageComplete(runId, stageKey, outputJson);
  }

  await db
    .update(scriptAgentRuns)
    .set({
      status: "complete",
      currentStage: "finalize_script",
      resultJson: result,
      completedAt: new Date(),
      updatedAt: new Date(),
      errorText: null,
    })
    .where(eq(scriptAgentRuns.id, runId));

  return {
    result,
    compiledResearchTextLength: compiledResearchText.length,
  };
}

export async function createScriptAgentRun(input: ScriptAgentRequest) {
  const db = getDb();
  const [run] = await db
    .insert(scriptAgentRuns)
    .values({
      storyTitle: input.storyTitle,
      status: "pending",
      researchDepth: input.researchDepth,
      requestJson: input,
    })
    .returning();

  await db.insert(scriptAgentStages).values(
    SCRIPT_AGENT_STAGE_ORDER.map((stageKey, index): typeof scriptAgentStages.$inferInsert => ({
      runId: run.id,
      stageKey,
      stageOrder: index + 1,
      status: "pending",
    }))
  );

  return run;
}

export async function enqueueScriptAgentRun(runId: string) {
  const db = getDb();

  if (isTriggerConfigured()) {
    const handle = await tasks.trigger(SCRIPT_AGENT_TASK_ID, {
      runId,
    });

    await db
      .update(scriptAgentRuns)
      .set({
        status: "queued",
        triggerRunId: handle.id,
        updatedAt: new Date(),
      })
      .where(eq(scriptAgentRuns.id, runId));

    return {
      mode: "trigger" as const,
      triggerRunId: handle.id,
      status: "queued" as const,
    };
  }

  await runScriptAgentTask({ runId });

  return {
    mode: "inline" as const,
    triggerRunId: null,
    status: "complete" as const,
  };
}

export async function runScriptAgentTask(input: { runId: string }) {
  const db = getDb();
  const run = await db
    .select()
    .from(scriptAgentRuns)
    .where(eq(scriptAgentRuns.id, input.runId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!run) {
    throw new Error(`Script agent run not found: ${input.runId}`);
  }

  const request = run.requestJson as ScriptAgentRequest;

  try {
    await runStage(input.runId, "discover_sources", { storyTitle: request.storyTitle }, () =>
      discoverSourcesForRun(input.runId, request)
    );
    await runStage(input.runId, "ingest_sources", { researchDepth: request.researchDepth }, () =>
      ingestSourcesForRun(input.runId, request)
    );
    await runStage(input.runId, "extract_evidence", { storyTitle: request.storyTitle }, () =>
      extractEvidenceForRun(input.runId, request)
    );
    await markStageRunning(input.runId, "synthesize_research", {
      storyTitle: request.storyTitle,
      researchDepth: request.researchDepth,
    });
    const synthesized = await synthesizeAndWriteRun(input.runId, request);
    await markStageComplete(input.runId, "synthesize_research", synthesized.result.stages?.research ?? null);
    return synthesized;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown script-agent error";
    await db
      .update(scriptAgentRuns)
      .set({
        status: "failed",
        errorText: message,
        updatedAt: new Date(),
      })
      .where(eq(scriptAgentRuns.id, input.runId));
    throw error;
  }
}

export async function getScriptAgentRun(runId: string): Promise<ScriptAgentRun | null> {
  const db = getDb();
  const [run, stages, sources, quotes, claims] = await Promise.all([
    db
      .select()
      .from(scriptAgentRuns)
      .where(eq(scriptAgentRuns.id, runId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(scriptAgentStages)
      .where(eq(scriptAgentStages.runId, runId))
      .orderBy(asc(scriptAgentStages.stageOrder)),
    db
      .select()
      .from(scriptAgentSources)
      .where(eq(scriptAgentSources.runId, runId))
      .orderBy(desc(scriptAgentSources.createdAt)),
    db
      .select()
      .from(scriptAgentQuotes)
      .where(eq(scriptAgentQuotes.runId, runId))
      .orderBy(desc(scriptAgentQuotes.relevanceScore), desc(scriptAgentQuotes.createdAt)),
    db
      .select()
      .from(scriptAgentClaims)
      .where(eq(scriptAgentClaims.runId, runId))
      .orderBy(desc(scriptAgentClaims.supportLevel), asc(scriptAgentClaims.riskLevel)),
  ]);

  if (!run) {
    return null;
  }

  return serializeRunRecord({
    run,
    stages,
    sources,
    quotes,
    claims,
  });
}

export async function listRecentScriptAgentRuns(limit = 10): Promise<ScriptAgentRun[]> {
  const db = getDb();
  const runs = await db
    .select()
    .from(scriptAgentRuns)
    .orderBy(desc(scriptAgentRuns.createdAt))
    .limit(limit);

  const result: ScriptAgentRun[] = [];
  for (const run of runs) {
    const hydrated = await getScriptAgentRun(run.id);
    if (hydrated) {
      result.push(hydrated);
    }
  }
  return result;
}
