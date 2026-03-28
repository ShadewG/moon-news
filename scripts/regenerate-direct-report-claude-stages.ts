import "server-only";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type {
  ScriptEvidenceQuote,
  ScriptOutlineStage,
  ScriptQuotePlacementStage,
  ScriptQuoteSelectionStage,
  ScriptResearchStage,
  ScriptSectionPlanStage,
} from "@/lib/script-lab";
import { scriptLabRequestSchema } from "@/lib/script-lab";
import {
  createAnthropicJson,
  generateOutlineStage,
  generateQuotePlacementStage,
  generateQuoteSelectionStage,
  generateResearchStage,
  generateSectionPlanStage,
  generateStoryboardStage,
  getAnthropicWritingModel,
} from "@/server/services/script-lab";

type ArticleCard = {
  title: string;
  url: string;
  source: string;
  role: "core_receipts" | "system" | "legal" | "background";
  snippet: string;
  publishedAt: string | null;
  factExtract:
    | {
        sourceTitle: string;
        keyFacts: string[];
        namedActors: string[];
        operationalDetails: string[];
        motiveFrames: string[];
        relationshipTurns: string[];
        deterrents: string[];
        exactQuotes: string[];
      }
    | null;
};

type SocialPostCard = {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  relevanceScore: number;
};

type DiscoveredClipCard = {
  title: string;
  provider: string;
  sourceUrl: string;
  channelOrContributor: string | null;
  relevanceScore: number;
};

type TranscriptQuoteCard = {
  sourceLabel: string;
  sourceUrl: string;
  quoteText: string;
  speaker: string | null;
  context: string | null;
  startMs: number | null;
  endMs: number | null;
  relevanceScore: number;
};

type DirectOutlineArtifact = {
  slug: string;
  title: string;
  generatedAt: string;
  briefText: string | null;
  deepResearch: {
    processor: string;
    runId: string;
    interactionId: string | null;
    status: string | null;
    content: string;
    basisCount: number | null;
  } | null;
  articleQueries: string[];
  mediaQueries: string[];
  articleCards: ArticleCard[];
  socialPosts: SocialPostCard[];
  discoveredClips: DiscoveredClipCard[];
  transcriptQuotes: TranscriptQuoteCard[];
  researchStage?: ScriptResearchStage;
  outlineStage?: ScriptOutlineStage;
  quoteSelectionStage?: ScriptQuoteSelectionStage;
  quotePlacementStage?: ScriptQuotePlacementStage;
  sectionPlanStage?: ScriptSectionPlanStage;
  whyItMattersStage?: {
    whyItMattersNow: string;
    modernDayRelevance: string[];
    tweetWatchlist: string[];
  };
  sectionClipPackages?: Array<Record<string, unknown>>;
  stageFallbackReason?: string | null;
};

const whyItMattersStageSchema = z.object({
  whyItMattersNow: z.string().trim().min(1),
  modernDayRelevance: z.array(z.string().trim().min(1)).min(2).max(6),
  tweetWatchlist: z.array(z.string().trim().min(1)).max(6).default([]),
});

const QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const STRONG_QUOTE_TERMS = [
  "reading",
  "literacy",
  "school",
  "screen",
  "attention",
  "classroom",
  "teacher",
  "student",
  "book",
  "algorithm",
  "tiktok",
  "youtube",
];

function dedupeBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    const rawKey = getKey(item)?.trim();
    if (!rawKey) {
      deduped.push(item);
      continue;
    }
    const key = rawKey.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function tokenizeKeywords(text: string, max = 10) {
  const tokens = text.match(/[A-Za-z0-9][A-Za-z0-9'_-]*/g) ?? [];
  const seen = new Set<string>();
  const collected: string[] = [];

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (QUERY_STOPWORDS.has(normalized) || normalized.length < 3) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    collected.push(normalized);
    if (collected.length >= max) {
      break;
    }
  }

  return collected;
}

function countKeywordHits(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword)).length;
}

function buildSectionKeywords(parts: Array<string | null | undefined>, max = 16) {
  return tokenizeKeywords(parts.filter(Boolean).join(" "), max);
}

function scoreSectionTextMatch(text: string, keywords: string[]) {
  const normalized = text.toLowerCase();
  return countKeywordHits(normalized, keywords) * 10 + countKeywordHits(normalized, STRONG_QUOTE_TERMS) * 4;
}

function trimToLength(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function getTargetWordRange(targetRuntimeMinutes: number) {
  const targetWords =
    targetRuntimeMinutes >= 10
      ? Math.max(2500, Math.round(targetRuntimeMinutes * 205))
      : Math.round(targetRuntimeMinutes * 185);
  const minWords = Math.max(
    600,
    targetWords - (targetRuntimeMinutes >= 10 ? 200 : 120)
  );
  const maxWords = Math.max(
    minWords + 220,
    targetWords + (targetRuntimeMinutes >= 10 ? 200 : 150)
  );
  return {
    targetWords,
    minWords,
    maxWords,
  };
}

function buildDirectResearchPacket(input: {
  storyTitle: string;
  targetRuntimeMinutes: number;
  notes: string;
  researchText: string;
}) {
  const targetWordRange = getTargetWordRange(input.targetRuntimeMinutes);
  return [
    `Story title: ${input.storyTitle}`,
    `Target runtime: ${input.targetRuntimeMinutes} minutes`,
    `Ideal script length: about ${targetWordRange.targetWords} words`,
    `Target script length: ${targetWordRange.minWords}-${targetWordRange.maxWords} words`,
    "",
    "Moon style packet (binding for every stage):",
    "- Voice should feel spoken, skeptical, documentary-driven, and culturally reflective.",
    "- Prefer anomaly -> mechanism -> system -> turn -> consequence.",
    "- Use clips and direct quotes as pressure, not decoration.",
    "- Avoid generic explainer tone, school-report framing, and repetitive moralizing.",
    "- Keep transitions causal and escalating.",
    input.notes ? `\nAdditional notes:\n${input.notes}` : null,
    "",
    "Research dossier:",
    input.researchText,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildResearchText(artifact: DirectOutlineArtifact) {
  const parts: string[] = [
    `Headline-only research build for: ${artifact.title}`,
    artifact.briefText ? `Editorial brief:\n${artifact.briefText}` : null,
    artifact.deepResearch?.content
      ? `Parallel deep research memo:\n${trimToLength(artifact.deepResearch.content, 12000)}`
      : null,
    `Article queries used: ${(artifact.articleQueries ?? []).join(" | ")}`,
    `Media queries used: ${(artifact.mediaQueries ?? []).join(" | ")}`,
    "",
    "Transcript-backed quotes:",
  ].filter(Boolean) as string[];

  if ((artifact.transcriptQuotes ?? []).length === 0) {
    parts.push("None captured.");
  } else {
    for (const quote of artifact.transcriptQuotes) {
      parts.push(
        [
          `Source: ${quote.sourceLabel}`,
          `URL: ${quote.sourceUrl}`,
          typeof quote.startMs === "number" ? `Timestamp: ${quote.startMs}` : null,
          `Quote: ${quote.quoteText}`,
          quote.context ? `Context: ${quote.context}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
      parts.push("");
    }
  }

  parts.push("Organized article research:");
  for (const article of artifact.articleCards ?? []) {
    parts.push(
      [
        `Role: ${article.role}`,
        `Source: ${article.title}`,
        `URL: ${article.url}`,
        article.publishedAt ? `Published: ${article.publishedAt}` : null,
        article.snippet ? `Snippet: ${article.snippet}` : null,
        article.factExtract?.keyFacts?.length
          ? `Key facts: ${article.factExtract.keyFacts.join(" | ")}`
          : null,
        article.factExtract?.namedActors?.length
          ? `Named actors: ${article.factExtract.namedActors.join(" | ")}`
          : null,
        article.factExtract?.operationalDetails?.length
          ? `Operational details: ${article.factExtract.operationalDetails.join(" | ")}`
          : null,
        article.factExtract?.motiveFrames?.length
          ? `Motive frames: ${article.factExtract.motiveFrames.join(" | ")}`
          : null,
        article.factExtract?.exactQuotes?.length
          ? `Exact quotes: ${article.factExtract.exactQuotes.join(" | ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
    parts.push("");
  }

  if ((artifact.socialPosts ?? []).length > 0) {
    parts.push("Notable social posts / tweet leads:");
    for (const post of artifact.socialPosts) {
      parts.push(
        [
          `Post: ${post.title}`,
          `URL: ${post.url}`,
          post.publishedAt ? `Published: ${post.publishedAt}` : null,
          post.snippet ? `Snippet: ${post.snippet}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
      parts.push("");
    }
  }

  return trimToLength(parts.join("\n"), 48000);
}

function buildSeedQuoteEvidence(artifact: DirectOutlineArtifact): ScriptEvidenceQuote[] {
  const transcriptEvidence: ScriptEvidenceQuote[] = (artifact.transcriptQuotes ?? []).map((quote) => ({
    sourceType: "clip_transcript",
    sourceTitle: quote.sourceLabel,
    sourceUrl: quote.sourceUrl,
    quoteText: quote.quoteText,
    speaker: quote.speaker,
    context: quote.context ?? `Transcript-backed quote from ${quote.sourceLabel}`,
    relevanceScore: quote.relevanceScore,
    startMs: quote.startMs ?? undefined,
    endMs: quote.endMs ?? undefined,
  }));

  const articleEvidence: ScriptEvidenceQuote[] = (artifact.articleCards ?? []).flatMap((article) =>
    (article.factExtract?.exactQuotes ?? []).slice(0, 2).map((quoteText) => ({
      sourceType: "research_text" as const,
      sourceTitle: article.title,
      sourceUrl: article.url,
      quoteText,
      speaker: null,
      context: `Quoted text from ${article.title}`,
      relevanceScore: 66,
      startMs: undefined,
      endMs: undefined,
    }))
  );

  return dedupeBy(
    [...transcriptEvidence, ...articleEvidence],
    (quote) => `${quote.sourceUrl ?? ""}|${quote.quoteText}`
  ).slice(0, 16);
}

async function generateWhyItMattersStage(args: {
  title: string;
  briefText: string | null;
  deepResearch: DirectOutlineArtifact["deepResearch"];
  researchStage: ScriptResearchStage;
  socialPosts: SocialPostCard[];
}) {
  return createAnthropicJson({
    schema: whyItMattersStageSchema,
    model: getAnthropicWritingModel(),
    system:
      "You are the modern-relevance stage of a documentary research agent. Explain why this story matters now and what makes it culturally relevant today. Return JSON only.",
    user: [
      `Story: ${args.title}`,
      args.briefText ? `Editorial brief:\n${args.briefText}` : null,
      args.deepResearch?.content ? `Parallel deep research memo:\n${trimToLength(args.deepResearch.content, 10000)}` : null,
      `Research summary: ${args.researchStage.summary}`,
      `Thesis: ${args.researchStage.thesis}`,
      `Key claims: ${args.researchStage.keyClaims.join(" | ")}`,
      args.socialPosts.length > 0
        ? `Social post leads:\n${args.socialPosts.map((post) => `- ${post.title} (${post.url})`).join("\n")}`
        : null,
      "",
      "Return JSON with:",
      "{",
      '  "whyItMattersNow": "one compact paragraph that makes the present-day relevance explicit",',
      '  "modernDayRelevance": ["point 1", "point 2", "point 3"],',
      '  "tweetWatchlist": ["specific tweet or post lead to verify", "another lead"]',
      "}",
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature: 0.25,
    maxTokens: 1400,
  });
}

function buildSectionClipPackages(args: {
  outlineStage: ScriptOutlineStage;
  quoteSelectionStage: ScriptQuoteSelectionStage;
  quotePlacementStage: ScriptQuotePlacementStage;
  sectionPlanStage: ScriptSectionPlanStage;
  discoveredClips: DiscoveredClipCard[];
  articleCards: ArticleCard[];
  socialPosts: SocialPostCard[];
  transcriptQuotes: TranscriptQuoteCard[];
}) {
  const selectedQuotesById = new Map(
    args.quoteSelectionStage.selectedQuotes.map((quote) => [quote.quoteId, quote] as const)
  );

  return args.sectionPlanStage.sections.map((sectionPlan) => {
    const placement = args.quotePlacementStage.placements.find(
      (item) => item.sectionHeading === sectionPlan.sectionHeading
    );
    const outlineSection = args.outlineStage.sections.find(
      (section) => section.heading === sectionPlan.sectionHeading
    );
    const sectionKeywords = buildSectionKeywords([
      sectionPlan.sectionHeading,
      sectionPlan.narrativeRole,
      sectionPlan.openingMove,
      sectionPlan.closingMove,
      outlineSection?.purpose,
      outlineSection?.beatGoal,
      ...(outlineSection?.evidenceSlots ?? []),
    ]);
    const sectionQuoteIds = [
      ...(placement?.requiredQuoteIds ?? []),
      ...(placement?.optionalQuoteIds ?? []),
    ];

    const exactQuotes = dedupeBy(
      sectionQuoteIds
        .map((quoteId) => selectedQuotesById.get(quoteId))
        .filter(Boolean)
        .map((quote) => ({
          quoteId: quote!.quoteId,
          sourceType: quote!.sourceType,
          sourceTitle: quote!.sourceTitle,
          sourceUrl: quote!.sourceUrl,
          quoteText: quote!.quoteText,
          speaker: quote!.speaker,
          context: quote!.context,
          relevanceScore: quote!.relevanceScore,
          usageRole: quote!.usageRole,
          startMs: quote!.startMs,
          endMs: quote!.endMs,
        })),
      (quote) => `${quote.sourceUrl ?? ""}|${quote.quoteText}`
    );

    const transcriptQuotes = dedupeBy(
      args.transcriptQuotes
        .filter(
          (quote) =>
            scoreSectionTextMatch(
              `${quote.sourceLabel} ${quote.quoteText} ${quote.context ?? ""}`,
              sectionKeywords
            ) >= 10
        )
        .sort(
          (left, right) =>
            scoreSectionTextMatch(
              `${right.sourceLabel} ${right.quoteText} ${right.context ?? ""}`,
              sectionKeywords
            ) -
              scoreSectionTextMatch(
                `${left.sourceLabel} ${left.quoteText} ${left.context ?? ""}`,
                sectionKeywords
              ) ||
            right.relevanceScore - left.relevanceScore
        ),
      (quote) => `${quote.sourceUrl}|${quote.startMs}|${quote.quoteText}`
    ).slice(0, 5);

    const keyClipsToWatch = dedupeBy(
      args.discoveredClips
        .map((clip) => ({
          clip,
          score: scoreSectionTextMatch(
            `${clip.title} ${clip.channelOrContributor ?? ""}`,
            sectionKeywords
          ) + clip.relevanceScore,
        }))
        .filter((item) => item.score >= 40)
        .sort((left, right) => right.score - left.score)
        .map((item) => item.clip),
      (clip) => clip.sourceUrl
    ).slice(0, 4);

    const relatedArticles = dedupeBy(
      args.articleCards
        .map((article) => ({
          article,
          score: scoreSectionTextMatch(
            [
              article.title,
              article.snippet,
              ...(article.factExtract?.keyFacts ?? []),
              ...(article.factExtract?.namedActors ?? []),
              ...(article.factExtract?.motiveFrames ?? []),
            ].join(" "),
            sectionKeywords
          ),
        }))
        .filter((item) => item.score >= 10)
        .sort((left, right) => right.score - left.score)
        .map(({ article }) => ({
          title: article.title,
          url: article.url,
          source: article.source,
          role: article.role,
          snippet: article.snippet,
          publishedAt: article.publishedAt,
          keyPoints: dedupeBy(
            [
              ...(article.factExtract?.keyFacts ?? []),
              ...(article.factExtract?.operationalDetails ?? []),
              ...(article.factExtract?.motiveFrames ?? []),
            ],
            (item) => item
          ).slice(0, 4),
        })),
      (article) => article.url
    ).slice(0, 4);

    const relatedSocialPosts = dedupeBy(
      args.socialPosts
        .map((post) => ({
          post,
          score: scoreSectionTextMatch(`${post.title} ${post.snippet}`, sectionKeywords),
        }))
        .filter((item) => item.score >= 8)
        .sort((left, right) => right.score - left.score)
        .map(({ post }) => post),
      (post) => post.url
    ).slice(0, 3);

    return {
      sectionHeading: sectionPlan.sectionHeading,
      narrativeRole: sectionPlan.narrativeRole,
      purpose: outlineSection?.purpose ?? "",
      beatGoal: outlineSection?.beatGoal ?? "",
      targetWordCount: outlineSection?.targetWordCount ?? null,
      evidenceSlots: outlineSection?.evidenceSlots ?? [],
      whyItMattersNow: outlineSection?.beatGoal ?? sectionPlan.narrativeRole,
      openingMove: sectionPlan.openingMove,
      closingMove: sectionPlan.closingMove,
      exactQuotes,
      transcriptQuotes,
      keyClipsToWatch,
      relatedArticles,
      relatedSocialPosts,
    };
  });
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: tsx scripts/regenerate-direct-report-claude-stages.ts <artifact-json-path>");
  }

  const artifactPath = path.resolve(process.cwd(), inputPath);
  const artifact = JSON.parse(
    await readFile(artifactPath, "utf8")
  ) as DirectOutlineArtifact;

  const researchText = buildResearchText(artifact);
  const input = scriptLabRequestSchema.parse({
    storyTitle: artifact.title,
    researchText,
    notes: artifact.briefText ?? "",
    targetRuntimeMinutes: 12,
  });
  const seedQuoteEvidence = buildSeedQuoteEvidence(artifact);
  const targetWordRange = getTargetWordRange(input.targetRuntimeMinutes);
  const researchPacket = buildDirectResearchPacket(input);
  const moonAnalysis = {
    analogs: [],
  } as Awaited<Parameters<typeof generateResearchStage>[0]["moonAnalysis"]>;
  console.log("[claude-refresh] researchStage");
  const researchStage = await generateResearchStage({
    input,
    moonAnalysis,
    researchPacket,
    seedQuoteEvidence,
  });
  console.log("[claude-refresh] outlineStage");
  const outlineStage = await generateOutlineStage({
    researchPacket,
    researchStage,
    targetWordRange,
  });
  console.log("[claude-refresh] quoteSelectionStage");
  const quoteSelectionStage = await generateQuoteSelectionStage({
    researchPacket,
    researchStage,
  });
  console.log("[claude-refresh] quotePlacementStage");
  const quotePlacementStage = await generateQuotePlacementStage({
    researchPacket,
    researchStage,
    outlineStage,
    quoteSelectionStage,
  });
  console.log("[claude-refresh] storyboardStage");
  const storyboardStage = generateStoryboardStage({
    outlineStage,
    researchStage,
  });
  console.log("[claude-refresh] sectionPlanStage");
  const sectionPlanStage = await generateSectionPlanStage({
    researchPacket,
    researchStage,
    quoteSelectionStage,
    outlineStage,
    quotePlacementStage,
    storyboardStage,
  });
  console.log("[claude-refresh] whyItMattersStage");
  const whyItMattersStage = await generateWhyItMattersStage({
    title: artifact.title,
    briefText: artifact.briefText ?? null,
    deepResearch: artifact.deepResearch ?? null,
    researchStage,
    socialPosts: artifact.socialPosts ?? [],
  });

  const sectionClipPackages = buildSectionClipPackages({
    outlineStage,
    quoteSelectionStage,
    quotePlacementStage,
    sectionPlanStage,
    discoveredClips: artifact.discoveredClips ?? [],
    articleCards: artifact.articleCards ?? [],
    socialPosts: artifact.socialPosts ?? [],
    transcriptQuotes: artifact.transcriptQuotes ?? [],
  });

  const updated: DirectOutlineArtifact = {
    ...artifact,
    generatedAt: new Date().toISOString(),
    researchStage,
    outlineStage,
    quoteSelectionStage,
    quotePlacementStage,
    sectionPlanStage,
    whyItMattersStage,
    sectionClipPackages,
    stageFallbackReason: null,
  };

  await writeFile(artifactPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        artifactPath,
        model: getAnthropicWritingModel(),
        sections: outlineStage.sections.length,
        selectedQuotes: quoteSelectionStage.selectedQuotes.length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
