import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  scriptLabRequestSchema,
  scriptOutlineStageSchema,
  type ScriptEvidenceQuote,
  type ScriptOutlineStage,
  type ScriptQuotePlacementStage,
  type ScriptResearchStage,
  type ScriptQuoteSelectionStage,
  type ScriptSectionPlanStage,
} from "@/lib/script-lab";
import { extractContent } from "@/server/services/board/content-extractor";
import { searchNewsStory } from "@/server/services/board/news-search";
import { ingestLocalMediaArtifacts } from "@/server/providers/local-media";
import {
  extractArticleFactsFromMarkdown,
  findRelevantQuotes,
} from "@/server/providers/openai";
import {
  createAnthropicJson,
  getAnthropicWritingModel,
  generateQuotePlacementStage,
  generateQuoteSelectionStage,
  generateSectionPlanStage,
  generateOutlineStage,
  generateResearchStage,
  generateStoryboardStage,
  prepareScriptLabPipelineContext,
} from "@/server/services/script-lab";
import { requireEnv } from "@/server/config/env";
import { ensureYouTubeTranscript } from "@/server/services/clip-library";
import { searchTopic } from "@/server/services/topic-search";
import { assessMediaSourceCandidate, shouldExcludeCommentaryCandidate } from "@/server/services/media-source-classification";
import { searchTwitterPosts } from "@/server/providers/twitter";
import {
  runDeepResearchMemo,
  extractResearchSource,
  searchResearchSources,
  type ParallelResearchResult,
} from "@/server/providers/parallel";

type ArticleCard = {
  title: string;
  url: string;
  source: string;
  role: "core_receipts" | "system" | "legal" | "background";
  snippet: string;
  publishedAt: string | null;
  contentLength: number;
  extractedTitle: string | null;
  extractedSiteName: string | null;
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
  error: string | null;
};

type TranscriptSourceCard = {
  title: string;
  provider: string;
  sourceUrl: string;
  transcriptStatus: "complete" | "failed";
  transcriptSegments: number;
  transcriptError: string | null;
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

type DiscoveredClipCard = {
  title: string;
  provider: string;
  sourceUrl: string;
  channelOrContributor: string | null;
  relevanceScore: number;
};

type SocialPostCard = {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  relevanceScore: number;
};

type DeepResearchCard = {
  processor: string;
  runId: string;
  interactionId: string | null;
  status: string | null;
  content: string;
  basisCount: number | null;
};

type WhyItMattersStage = {
  whyItMattersNow: string;
  modernDayRelevance: string[];
  tweetWatchlist: string[];
};

type QueryPlanStage = {
  articleQueries: string[];
  mediaQueries: string[];
  socialQueries: string[];
};

type SectionQueryPlan = {
  sectionHeading: string;
  articleQueries: string[];
  mediaQueries: string[];
  socialQueries: string[];
};

type LinkedEvidenceSlot = {
  label: string;
  sourceType: "clip_transcript" | "clip" | "article" | "social" | "unlinked";
  sourceTitle: string | null;
  sourceUrl: string | null;
  quoteText: string | null;
  context: string | null;
  startMs: number | null;
  endMs: number | null;
  note: string | null;
};

type SectionClipPackage = {
  sectionHeading: string;
  narrativeRole: string;
  purpose: string;
  beatGoal: string;
  targetWordCount: number | null;
  queryPlan: SectionQueryPlan | null;
  evidenceSlots: string[];
  linkedEvidenceSlots: LinkedEvidenceSlot[];
  whyItMattersNow: string;
  openingMove: string;
  closingMove: string;
  exactQuotes: Array<{
    quoteId: string;
    sourceType: "clip_transcript" | "research_text";
    sourceTitle: string;
    sourceUrl: string | null | undefined;
    quoteText: string;
    speaker: string | null | undefined;
    context: string | null | undefined;
    relevanceScore: number | null | undefined;
    usageRole: string;
    startMs: number | null | undefined;
    endMs: number | null | undefined;
  }>;
  transcriptQuotes: TranscriptQuoteCard[];
  keyClipsToWatch: DiscoveredClipCard[];
  relatedArticles: Array<{
    title: string;
    url: string;
    source: string;
    role: ArticleCard["role"];
    snippet: string;
    publishedAt: string | null;
    keyPoints: string[];
  }>;
  relatedSocialPosts: SocialPostCard[];
};

type SectionSourceBundle = {
  sectionHeading: string;
  articleSources: SectionClipPackage["relatedArticles"];
  clipSources: DiscoveredClipCard[];
  socialSources: SocialPostCard[];
};

function normalizeExternalUrl(url: string | null | undefined) {
  if (!url) return null;
  let normalized = url.trim();
  if (!normalized) return null;

  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) break;
      normalized = decoded;
    } catch {
      break;
    }
  }

  normalized = normalized.replace(
    /(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[^&?]+)\?t=(\d+)/i,
    "$1&t=$2"
  );

  try {
    const parsed = new URL(normalized);
    if (/youtube\.com$/i.test(parsed.hostname) && parsed.pathname === "/watch") {
      const videoValue = parsed.searchParams.get("v");
      if (videoValue?.includes("?t=")) {
        const [videoId, tValue] = videoValue.split("?t=");
        parsed.searchParams.set("v", videoId);
        if (tValue && !parsed.searchParams.get("t")) {
          parsed.searchParams.set("t", tValue);
        }
      }
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function sanitizeUrlFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUrlFields(item)) as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (typeof nested === "string" && (key === "sourceUrl" || key === "url" || key === "href")) {
        result[key] = normalizeExternalUrl(nested) ?? nested;
      } else {
        result[key] = sanitizeUrlFields(nested);
      }
    }
    return result as T;
  }
  return value;
}

function buildCanonicalResearchPacket(args: {
  slug: string;
  title: string;
  generatedAt: string;
  briefText: string;
  deepResearch: DeepResearchCard | null;
  articleQueries: string[];
  mediaQueries: string[];
  socialQueries: string[];
  articleCards: ArticleCard[];
  socialPosts: SocialPostCard[];
  discoveredClips: DiscoveredClipCard[];
  transcriptSources: TranscriptSourceCard[];
  transcriptQuotes: TranscriptQuoteCard[];
  researchStage: ScriptResearchStage;
  outlineStage: ScriptOutlineStage;
  quoteSelectionStage: ScriptQuoteSelectionStage;
  quotePlacementStage: ScriptQuotePlacementStage;
  sectionPlanStage: ScriptSectionPlanStage;
  whyItMattersStage: WhyItMattersStage;
  sectionClipPackages: SectionClipPackage[];
  stageFallbackReason: string | null;
}) {
  return {
    version: "v1",
    meta: {
      slug: args.slug,
      title: args.title,
      generatedAt: args.generatedAt,
      stageFallbackReason: args.stageFallbackReason,
    },
    brief: {
      text: args.briefText,
    },
    summary: {
      researchSummary: args.researchStage.summary,
      thesis: args.researchStage.thesis,
      keyClaims: args.researchStage.keyClaims,
      riskyClaims: args.researchStage.riskyClaims,
      whyItMattersNow: args.whyItMattersStage.whyItMattersNow,
      modernDayRelevance: args.whyItMattersStage.modernDayRelevance,
      tweetWatchlist: args.whyItMattersStage.tweetWatchlist,
    },
    discovery: {
      articleQueries: args.articleQueries,
      mediaQueries: args.mediaQueries,
      socialQueries: args.socialQueries,
      deepResearch: args.deepResearch,
    },
    sourcePools: {
      clips: dedupeBy(
        [
          ...args.discoveredClips,
          ...args.sectionClipPackages.flatMap((section) => section.keyClipsToWatch),
        ],
        (clip) => clip.sourceUrl
      ),
      transcriptSources: args.transcriptSources,
      transcriptQuotes: args.transcriptQuotes,
      articles: dedupeBy(
        [
          ...args.articleCards.map((article) => ({
            title: article.title,
            url: article.url,
            source: article.source,
            role: article.role,
            snippet: article.snippet,
            publishedAt: article.publishedAt,
            contentLength: article.contentLength,
            extractedTitle: article.extractedTitle,
            extractedSiteName: article.extractedSiteName,
            keyPoints: [
              ...(article.factExtract?.keyFacts ?? []),
              ...(article.factExtract?.operationalDetails ?? []),
              ...(article.factExtract?.motiveFrames ?? []),
            ].slice(0, 8),
            factExtract: article.factExtract,
            error: article.error,
          })),
          ...args.sectionClipPackages.flatMap((section) =>
            section.relatedArticles.map((article) => ({
              title: article.title,
              url: article.url,
              source: article.source,
              role: article.role,
              snippet: article.snippet,
              publishedAt: article.publishedAt,
              contentLength: 0,
              extractedTitle: article.title,
              extractedSiteName: null,
              keyPoints: article.keyPoints,
              factExtract: null,
              error: null,
            }))
          ),
        ],
        (article) => article.url
      ),
      socials: dedupeBy(
        [
          ...args.socialPosts,
          ...args.sectionClipPackages.flatMap((section) => section.relatedSocialPosts),
        ],
        (post) => post.url
      ),
    },
    stages: {
      research: args.researchStage,
      outline: args.outlineStage,
      quoteSelection: args.quoteSelectionStage,
      quotePlacement: args.quotePlacementStage,
      sectionPlan: args.sectionPlanStage,
      whyItMatters: args.whyItMattersStage,
    },
    sections: args.sectionClipPackages.map((section, index) => ({
      id: `section-${index + 1}`,
      order: index + 1,
      heading: section.sectionHeading,
      narrativeRole: section.narrativeRole,
      purpose: section.purpose,
      beatGoal: section.beatGoal,
      targetWordCount: section.targetWordCount,
      queryPlan: section.queryPlan,
      whyItMattersNow: section.whyItMattersNow,
      openingMove: section.openingMove,
      closingMove: section.closingMove,
      evidenceSlots: section.evidenceSlots,
      linkedEvidenceSlots: section.linkedEvidenceSlots,
      quotes: section.exactQuotes.map((quote) => ({
        id: quote.quoteId,
        sourceType: quote.sourceType,
        sourceTitle: quote.sourceTitle,
        sourceUrl: quote.sourceUrl ?? null,
        quoteText: quote.quoteText,
        speaker: quote.speaker ?? null,
        context: quote.context ?? null,
        relevanceScore: quote.relevanceScore ?? null,
        usageRole: quote.usageRole,
        startMs: quote.startMs ?? null,
        endMs: quote.endMs ?? null,
      })),
      transcriptQuotes: section.transcriptQuotes.map((quote) => ({
        sourceLabel: quote.sourceLabel,
        sourceUrl: quote.sourceUrl,
        quoteText: quote.quoteText,
        speaker: quote.speaker,
        context: quote.context,
        startMs: quote.startMs,
        endMs: quote.endMs,
        relevanceScore: quote.relevanceScore,
      })),
      clips: section.keyClipsToWatch.map((clip) => ({
        title: clip.title,
        provider: clip.provider,
        sourceUrl: clip.sourceUrl,
        channelOrContributor: clip.channelOrContributor,
        relevanceScore: clip.relevanceScore,
      })),
      articles: section.relatedArticles,
      socials: section.relatedSocialPosts,
    })),
  };
}

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

const STRONG_NEWS_HOST_BONUS: Record<string, number> = {
  "reuters.com": 24,
  "apnews.com": 24,
  "npr.org": 22,
  "pbs.org": 22,
  "scotusblog.com": 22,
  "nytimes.com": 20,
  "washingtonpost.com": 20,
  "theguardian.com": 18,
  "abcnews.go.com": 18,
  "abcnews.com": 18,
  "cnn.com": 16,
  "cbsnews.com": 14,
};

const LOW_VALUE_URL_PATTERNS = [
  /wikipedia\.org/i,
  /\/tag\//i,
  /\/tags\//i,
  /today'?s latest updates/i,
];

const TOPIC_SIGNAL_TERMS = [
  "trial",
  "verdict",
  "appeal",
  "judgment",
  "defamation",
  "lawsuit",
  "bankruptcy",
  "deposition",
  "admitted",
  "admission",
  "infowars",
  "hoax",
  "fake",
  "actors",
  "real",
];

const STRONG_QUOTE_TERMS = [
  "sandy hook",
  "100% real",
  "real",
  "fake",
  "actors",
  "hoax",
  "admit",
  "admitted",
  "wrong",
  "lied",
  "parents",
  "families",
  "defamation",
  "bankruptcy",
  "infowars",
];

const PROCEDURAL_QUOTE_PATTERNS = [
  /\bmr\.\b/i,
  /\bexhibit\b/i,
  /\bplaintiff\b/i,
  /\bdouble-sided document\b/i,
  /\bcourt correct\b/i,
  /\blet me help you\b/i,
  /\bdo you see\b/i,
  /\bwhat is that the day\b/i,
  /\bwe're talking to each other\b/i,
];

const COMMENTARY_SOURCE_PATTERNS = [
  /\bcommentary\b/i,
  /\bbreakdown\b/i,
  /\breaction\b/i,
  /\brecap\b/i,
  /\bcompilation\b/i,
  /\bhighlights\b/i,
  /\bclip(s)?\b/i,
  /\bpart \d+\b/i,
  /\bsaga\b/i,
  /\bclaims\b/i,
  /\bsued for\b/i,
];

const PROFILE_DEFAULT_ARTICLE_TERMS = [
  "career",
  "legacy",
  "interview",
  "controversy",
  "snl",
  "weekend update",
  "comedy",
];

const PROFILE_DEFAULT_MEDIA_TERMS = [
  "interview",
  "podcast",
  "full interview",
  "weekend update",
  "monologue",
  "appearance",
  "late night",
];

const PREFERRED_DIRECT_SOURCE_PATTERNS = [
  /\binterview\b/i,
  /\braw\b/i,
  /\bjoe rogan\b/i,
  /\bweekend update\b/i,
  /\bconan\b/i,
  /\bhoward stern\b/i,
  /\blarry king\b/i,
  /\btom green\b/i,
  /\bstandup\b/i,
  /\binfowars\b/i,
  /\b100%\s*real\b/i,
  /\bgovernment operation\b/i,
  /\binside job\b/i,
  /\baccepts\b/i,
  /\bconcedes\b/i,
  /\badmits\b/i,
];

const PROCEDURAL_SOURCE_PATTERNS = [
  /\bdeposition\b/i,
  /\btrial\b/i,
  /\bhearing\b/i,
  /\btestimony\b/i,
  /\bcourt(room)?\b/i,
  /\blaw&crime\b/i,
];

const NARRATED_QUOTE_PATTERNS = [
  /^conspiracy theorist\b/i,
  /^long after\b/i,
  /^after years\b/i,
  /^while he was\b/i,
  /^now,?\s*a jury\b/i,
  /^here'?s\b/i,
  /^victim'?s mother\b/i,
  /^family'?s attorney\b/i,
  /^alex jones\b.*\b(?:is|was|called|concedes|admits|claimed|says|backtracking)\b/i,
];

const STRONG_FACT_PATTERNS = [
  /100%\s*real/i,
  /sandy hook/i,
  /crisis actors/i,
  /fake/i,
  /hoax/i,
  /inside job/i,
  /government operation/i,
];

const QUOTE_LEADIN_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "but",
  "for",
  "i",
  "if",
  "it",
  "its",
  "of",
  "or",
  "that",
  "the",
  "they",
  "this",
  "to",
  "we",
  "you",
]);

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function loadExistingDeepResearch(slug: string) {
  const artifactPath = path.resolve(process.cwd(), "research", `direct-outline-${slug}.json`);
  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as { deepResearch?: DeepResearchCard | null };
    return parsed.deepResearch ?? null;
  } catch {
    return null;
  }
}

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function getNormalizedHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
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

function extractEntityPhrases(text: string, max = 10) {
  const matches =
    text.match(
      /\b(?:[A-Z](?:\.[A-Z]\.)?|[A-Z][a-z]+)(?:\s+(?:[A-Z](?:\.[A-Z]\.)?|[A-Z][a-z]+|&)){0,4}\b/g
    ) ?? [];
  const rejected = new Set([
    "Core",
    "The",
    "This",
    "That",
    "Moon",
    "Key",
    "The script",
    "The bigger purpose",
    "The second half",
  ]);

  return dedupeBy(
    matches
      .map((match) => match.replace(/\s+/g, " ").trim())
      .filter((match) => match.length >= 4)
      .filter((match) => match.includes(" ") || match.includes("."))
      .filter((match) => !rejected.has(match)),
    (match) => match
  ).slice(0, max);
}

function isProfileTopic(title: string, briefText: string | null) {
  if (!briefText) {
    return false;
  }
  const normalized = title.trim();
  if (!/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(normalized)) {
    return false;
  }
  const lowerBrief = briefText.toLowerCase();
  const storySignals = ["lawsuit", "trial", "incident", "security", "meta", "bankruptcy", "verdict"];
  return !storySignals.some((signal) => lowerBrief.includes(signal));
}

function buildBriefDrivenQueries(title: string, briefText: string) {
  const entities = extractEntityPhrases(briefText, 12).filter(
    (entity) =>
      entity.toLowerCase() !== title.toLowerCase()
      && !title.toLowerCase().includes(entity.toLowerCase())
  );
  const normalizedTitle = title.trim();
  const articleQueries = entities.flatMap((entity) => [
    `${normalizedTitle} ${entity}`,
    `${normalizedTitle} ${entity} joke`,
  ]);
  const mediaQueries = entities.flatMap((entity) => [
    `${normalizedTitle} ${entity}`,
    `${normalizedTitle} ${entity} interview`,
    `${normalizedTitle} ${entity} clip`,
  ]);

  return {
    articleQueries: dedupeBy(articleQueries, (item) => item).slice(0, 8),
    mediaQueries: dedupeBy(mediaQueries, (item) => item).slice(0, 10),
  };
}

const queryPlanStageSchema = z.object({
  articleQueries: z.array(z.string().trim().min(4)).min(6).max(14),
  mediaQueries: z.array(z.string().trim().min(4)).min(8).max(18),
  socialQueries: z.array(z.string().trim().min(4)).min(4).max(12),
});

const sectionQueryPlanStageSchema = z.object({
  sections: z.array(
    z.object({
      sectionHeading: z.string().trim().min(1),
      articleQueries: z.array(z.string().trim().min(4)).min(2).max(6),
      mediaQueries: z.array(z.string().trim().min(4)).min(2).max(6),
      socialQueries: z.array(z.string().trim().min(4)).min(1).max(4),
    })
  ).min(1).max(12),
});

async function generateQueryPlanStage(args: {
  title: string;
  briefText: string | null;
  deepResearch: DeepResearchCard | null;
  profileTopic: boolean;
}) {
  return createAnthropicJson({
    schema: queryPlanStageSchema,
    model: getAnthropicWritingModel(),
    system: [
      "You are the search-query planning stage of a documentary research agent.",
      "Your job is to generate varied, high-yield search queries for article discovery, source-clip discovery, and social discovery.",
      "Do NOT parrot the documentary title over and over.",
      "Most queries should NOT be the exact story title with a weak suffix.",
      "Translate the editorial brief into concrete source-hunting queries that target institutions, named actors, timelines, policy decisions, source interviews, hearings, speeches, podcasts, news segments, and direct witness/expert evidence.",
      "For media queries, prioritize original/source material over commentary wrappers.",
      "For social queries, prioritize original tweets/posts, Reddit threads, teacher posts, creator posts, or comment/discussion lanes that are directly useful to the documentary.",
      "Prefer concrete search handles like NAEP, Oregon graduation requirements, chronic absenteeism, teacher testimony, YouTube Shorts, TikTok, Louisiana science of reading, named shows, named interviewers, named agencies, named people, and named institutions whenever relevant.",
      "For issue stories, build searches around the underlying evidence and actors, not the documentary headline.",
      "For profile stories, build searches around the person's direct appearances, controversies, targets, and consequences.",
      "Return concise search queries only.",
    ].join(" "),
    user: [
      `Story title: ${args.title}`,
      args.briefText ? `Editorial brief:\n${args.briefText}` : null,
      args.deepResearch?.content
        ? `Parallel deep research memo:\n${trimToLength(args.deepResearch.content, 12000)}`
        : null,
      `Topic type: ${args.profileTopic ? "profile / person-centered story" : "issue / event / systems story"}`,
      "",
      "Requirements:",
      "- Article queries should target reporting, data, timelines, policy changes, institutions, and named sub-angles.",
      "- Media queries should target interviews, speeches, hearings, podcasts, press clips, classroom footage, expert clips, original news segments, and other direct/source video.",
      "- Social queries should target original posts, Reddit discussions, teacher/social proof, and memorable online reactions.",
      "- Avoid repeating the exact title with useless suffixes.",
      "- Prefer variety and source-seeking over slogan-like phrasing.",
      "- At least two-thirds of the queries in each lane should avoid using the exact story title verbatim.",
      "- Use concrete nouns from the brief or deep research memo whenever possible.",
      "- Bad example: 'Gen Alpha Still Can't Read Anything timeline'.",
      "- Good example style: 'NAEP 2024 reading below basic fourth grade', 'Oregon graduation requirement reading 2029', 'teacher says seventh graders reading at fourth grade level', 'YouTube Shorts kids attention span reading teachers'.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature: 0.2,
    maxTokens: 1800,
  });
}

function buildFallbackQueryPlan(args: {
  title: string;
  briefText: string | null;
  deepResearch: DeepResearchCard | null;
  profileTopic: boolean;
}): QueryPlanStage {
  const briefDrivenQueries = args.briefText
    ? buildBriefDrivenQueries(args.title, args.briefText)
    : null;
  const deepResearchEntities = args.deepResearch?.content
    ? extractEntityPhrases(args.deepResearch.content, 10)
    : [];

  const articleQueries = dedupeBy(
    args.profileTopic
      ? [
          args.title,
          `${args.title} timeline`,
          ...PROFILE_DEFAULT_ARTICLE_TERMS.map((term) => `${args.title} ${term}`),
          ...(briefDrivenQueries?.articleQueries ?? []),
          ...deepResearchEntities.flatMap((entity) => [
            `${entity} ${args.title}`,
            `${entity} ${args.title} interview`,
          ]),
        ]
      : [
          args.title,
          `${args.title} reading scores`,
          `${args.title} naep`,
          `${args.title} absenteeism`,
          `${args.title} screen time`,
          `${args.title} graduation requirements`,
          ...(briefDrivenQueries?.articleQueries ?? []),
          ...deepResearchEntities.flatMap((entity) => [
            `${entity} ${args.title}`,
            `${entity} policy ${args.title}`,
          ]),
        ],
    (item) => item
  ).slice(0, 12);

  const mediaQueries = dedupeBy(
    args.profileTopic
      ? [
          args.title,
          ...PROFILE_DEFAULT_MEDIA_TERMS.map((term) => `${args.title} ${term}`),
          ...(briefDrivenQueries?.mediaQueries ?? []),
          ...deepResearchEntities.flatMap((entity) => [
            `${entity} ${args.title} clip`,
            `${entity} ${args.title} interview`,
          ]),
        ]
      : [
          `${args.title} teacher`,
          `${args.title} classroom`,
          `${args.title} interview`,
          `${args.title} panel discussion`,
          `${args.title} news segment`,
          `${args.title} podcast`,
          `${args.title} speech`,
          `${args.title} hearing`,
          ...(briefDrivenQueries?.mediaQueries ?? []),
          ...deepResearchEntities.flatMap((entity) => [
            `${entity} interview`,
            `${entity} clip`,
          ]),
        ],
    (item) => item
  ).slice(0, 16);

  const socialQueries = dedupeBy(
    [
      `${args.title} tweet`,
      `${args.title} x.com status`,
      `${args.title} reddit`,
      `${args.title} teacher reddit`,
      ...(briefDrivenQueries?.articleQueries ?? []).slice(0, 4),
      ...deepResearchEntities.flatMap((entity) => [
        `${entity} tweet`,
        `${entity} reddit`,
      ]),
    ],
    (item) => item
  ).slice(0, 10);

  return {
    articleQueries,
    mediaQueries,
    socialQueries,
  };
}

async function generateSectionQueryPlanStage(args: {
  title: string;
  briefText: string | null;
  deepResearch: DeepResearchCard | null;
  outlineStage: ScriptOutlineStage;
  globalQueryPlan: QueryPlanStage;
}) {
  const fallbackSections = buildFallbackSectionQueryPlans({
    outlineStage: args.outlineStage,
    globalQueryPlan: args.globalQueryPlan,
  });
  const model = getAnthropicWritingModel();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": requireEnv("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2600,
      temperature: 0.2,
      system: [
        "You are the section-level query planner for a documentary research agent.",
        "Generate tightly focused article, media, and social search queries for each outline section.",
        "These queries should help a second-pass researcher collect exact links, clips, quotes, interviews, posts, and receipts for that specific section.",
        "Prefer source-seeking, institution-seeking, and evidence-seeking phrasing.",
        "Do not just repeat the global queries or the documentary title.",
        "Each section should get queries tailored to its own narrative role, evidence slots, and beat goal.",
        "For media queries, prioritize direct/source video over commentary wrappers.",
        "Return markdown only in this exact shape:",
        "## Section 1: <section heading>",
        "",
        "**Article queries:**",
        "- query",
        "",
        "**Media queries:**",
        "- query",
        "",
        "**Social queries:**",
        "- query",
        "",
        "Repeat for every section in order. No prose before or after the sections.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `Story title: ${args.title}`,
            args.briefText ? `Editorial brief:\n${args.briefText}` : null,
            args.deepResearch?.content
              ? `Parallel deep research memo:\n${trimToLength(args.deepResearch.content, 10000)}`
              : null,
            `Outline sections:\n${args.outlineStage.sections
              .map(
                (section, index) =>
                  `${index + 1}. ${section.heading}\nPurpose: ${section.purpose}\nBeat goal: ${section.beatGoal}\nEvidence slots: ${section.evidenceSlots.join(" | ")}`
              )
              .join("\n\n")}`,
            `Global query plan already generated:\nArticle: ${args.globalQueryPlan.articleQueries.join(" | ")}\nMedia: ${args.globalQueryPlan.mediaQueries.join(" | ")}\nSocial: ${args.globalQueryPlan.socialQueries.join(" | ")}`,
            "Requirements:",
            "- Generate queries for each exact section heading.",
            "- Use concrete nouns, named actors, institutions, shows, reporters, agencies, metrics, or platforms where relevant.",
            "- Make the queries useful for collecting exact links for that section.",
            "- Prefer variety. Avoid title-parroting.",
            "- Keep article/media queries to around 4-6 each and social queries to around 3-4 each.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text =
    payload.content
      ?.filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("\n") ?? "";

  const sectionHeaderRegex = /^##\s*Section\s+(\d+):\s*(.+)$/gim;
  const sectionMatches = Array.from(text.matchAll(sectionHeaderRegex));

  if (sectionMatches.length === 0) {
    throw new Error("Section query planner did not return parseable markdown sections");
  }

  const parseLane = (block: string, label: "Article" | "Media" | "Social") => {
    const regex = new RegExp(
      String.raw`\*\*${label}\s+queries:\*\*\s*([\s\S]*?)(?=(?:\n\*\*(?:Article|Media|Social)\s+queries:\*\*)|(?:\n##\s*Section\b)|$)`,
      "i"
    );
    const match = block.match(regex);
    if (!match?.[1]) {
      return [];
    }
    return match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean);
  };

  const parsedSections = sectionMatches.map((match, index) => {
    const start = match.index ?? 0;
    const end = sectionMatches[index + 1]?.index ?? text.length;
    const block = text.slice(start, end);
    const sectionNumber = Number.parseInt(match[1] ?? "", 10);
    const outlineSection =
      args.outlineStage.sections[Number.isFinite(sectionNumber) ? sectionNumber - 1 : index]
      ?? args.outlineStage.sections[index];
    const fallback = fallbackSections[Number.isFinite(sectionNumber) ? sectionNumber - 1 : index]
      ?? fallbackSections[index];

    return {
      sectionHeading: outlineSection?.heading ?? match[2].trim(),
      articleQueries: dedupeBy(
        [...parseLane(block, "Article"), ...(fallback?.articleQueries ?? [])],
        (item) => item
      ).slice(0, 6),
      mediaQueries: dedupeBy(
        [...parseLane(block, "Media"), ...(fallback?.mediaQueries ?? [])],
        (item) => item
      ).slice(0, 6),
      socialQueries: dedupeBy(
        [...parseLane(block, "Social"), ...(fallback?.socialQueries ?? [])],
        (item) => item
      ).slice(0, 4),
    };
  });

  const normalizedSections = args.outlineStage.sections.map((section, index) => {
    const parsed = parsedSections[index];
    const fallback = fallbackSections[index];

    return {
      sectionHeading: section.heading,
      articleQueries: (parsed?.articleQueries?.length ? parsed.articleQueries : fallback.articleQueries).slice(0, 6),
      mediaQueries: (parsed?.mediaQueries?.length ? parsed.mediaQueries : fallback.mediaQueries).slice(0, 6),
      socialQueries: (parsed?.socialQueries?.length ? parsed.socialQueries : fallback.socialQueries).slice(0, 4),
    };
  });

  return sectionQueryPlanStageSchema.parse({ sections: normalizedSections });
}

function buildFallbackSectionQueryPlans(args: {
  outlineStage: ScriptOutlineStage;
  globalQueryPlan: QueryPlanStage;
}) {
  return args.outlineStage.sections.map<SectionQueryPlan>((section) => {
    const sectionKeywords = buildSectionKeywords(
      [section.heading, section.purpose, section.beatGoal, ...section.evidenceSlots],
      12
    );
    const matchQueries = (queries: string[], limit: number) =>
      dedupeBy(
        queries
          .filter((query) => scoreSectionTextMatch(query, sectionKeywords) > 0)
          .concat(
            sectionKeywords.slice(0, 3).map((keyword) => `${section.heading} ${keyword}`)
          ),
        (item) => item
      ).slice(0, limit);

    return {
      sectionHeading: section.heading,
      articleQueries: matchQueries(args.globalQueryPlan.articleQueries, 4),
      mediaQueries: matchQueries(args.globalQueryPlan.mediaQueries, 4),
      socialQueries: matchQueries(args.globalQueryPlan.socialQueries, 3),
    };
  });
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
  return (
    countKeywordHits(normalized, keywords) * 10 +
    countKeywordHits(normalized, STRONG_QUOTE_TERMS) * 4
  );
}

function buildLinkedEvidenceSlots(args: {
  evidenceSlots: string[];
  sectionKeywords: string[];
  exactQuotes: SectionClipPackage["exactQuotes"];
  transcriptQuotes: TranscriptQuoteCard[];
  keyClipsToWatch: DiscoveredClipCard[];
  relatedArticles: SectionClipPackage["relatedArticles"];
  relatedSocialPosts: SocialPostCard[];
}) {
  return args.evidenceSlots.map<LinkedEvidenceSlot>((slotLabel) => {
    const slotKeywords = buildSectionKeywords([slotLabel, ...args.sectionKeywords], 18);

    const quoteCandidates = [
      ...args.exactQuotes.map((quote) => ({
        score:
          60 +
          scoreSectionTextMatch(
            `${quote.sourceTitle} ${quote.quoteText} ${quote.context ?? ""} ${slotLabel}`,
            slotKeywords
          ),
        slot: {
          label: slotLabel,
          sourceType: quote.sourceType === "clip_transcript" ? "clip_transcript" : "article",
          sourceTitle: quote.sourceTitle,
          sourceUrl: quote.sourceUrl ?? null,
          quoteText: quote.quoteText,
          context: quote.context ?? quote.usageRole ?? null,
          startMs: quote.startMs ?? null,
          endMs: quote.endMs ?? null,
          note: "Matched to selected quote",
        } satisfies LinkedEvidenceSlot,
      })),
      ...args.transcriptQuotes.map((quote) => ({
        score:
          48 +
          scoreSectionTextMatch(
            `${quote.sourceLabel} ${quote.quoteText} ${quote.context ?? ""} ${slotLabel}`,
            slotKeywords
          ),
        slot: {
          label: slotLabel,
          sourceType: "clip_transcript" as const,
          sourceTitle: quote.sourceLabel,
          sourceUrl: quote.sourceUrl,
          quoteText: quote.quoteText,
          context: quote.context ?? null,
          startMs: quote.startMs ?? null,
          endMs: quote.endMs ?? null,
          note: "Matched to transcript passage",
        } satisfies LinkedEvidenceSlot,
      })),
    ];

    const clipCandidates = args.keyClipsToWatch.map((clip) => ({
      score:
        24 +
        scoreSectionTextMatch(
          `${clip.title} ${clip.channelOrContributor ?? ""} ${slotLabel}`,
          slotKeywords
        ),
      slot: {
        label: slotLabel,
        sourceType: "clip" as const,
        sourceTitle: clip.title,
        sourceUrl: clip.sourceUrl,
        quoteText: null,
        context: clip.channelOrContributor ?? null,
        startMs: null,
        endMs: null,
        note: "Matched to key clip",
      } satisfies LinkedEvidenceSlot,
    }));

    const articleCandidates = args.relatedArticles.map((article) => ({
      score:
        18 +
        scoreSectionTextMatch(
          `${article.title} ${article.snippet} ${article.keyPoints.join(" ")} ${slotLabel}`,
          slotKeywords
        ),
      slot: {
        label: slotLabel,
        sourceType: "article" as const,
        sourceTitle: article.title,
        sourceUrl: article.url,
        quoteText: null,
        context: article.keyPoints[0] ?? article.snippet ?? null,
        startMs: null,
        endMs: null,
        note: "Matched to related article",
      } satisfies LinkedEvidenceSlot,
    }));

    const socialCandidates = args.relatedSocialPosts.map((post) => ({
      score:
        14 +
        scoreSectionTextMatch(`${post.title} ${post.snippet} ${slotLabel}`, slotKeywords),
      slot: {
        label: slotLabel,
        sourceType: "social" as const,
        sourceTitle: post.title,
        sourceUrl: post.url,
        quoteText: null,
        context: post.snippet ?? null,
        startMs: null,
        endMs: null,
        note: "Matched to related social post",
      } satisfies LinkedEvidenceSlot,
    }));

    const best = [...quoteCandidates, ...clipCandidates, ...articleCandidates, ...socialCandidates]
      .sort((left, right) => right.score - left.score)[0];

    return (
      best?.slot ?? {
        label: slotLabel,
        sourceType: "unlinked",
        sourceTitle: null,
        sourceUrl: null,
        quoteText: null,
        context: null,
        startMs: null,
        endMs: null,
        note: "No linked source assigned yet",
      }
    );
  });
}

function inferSectionClipProvider(url: string) {
  const host = getNormalizedHostname(url);
  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    return "youtube";
  }
  return "parallel";
}

function inferSectionClipContributor(args: {
  url: string;
  title: string;
  snippet: string;
}) {
  const host = getNormalizedHostname(args.url);
  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    return null;
  }

  if (host) {
    return host.replace(/\.(com|org|net|gov|edu)$/i, "").replace(/\./g, " ");
  }

  return null;
}

function deriveSnippetKeyPoints(snippet: string, limit = 3) {
  return dedupeBy(
    snippet
      .split(/(?<=[.!?])\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 28)
      .map((item) => item.replace(/\s+/g, " ")),
    (item) => item
  ).slice(0, limit);
}

async function buildSectionArticleSource(result: ParallelResearchResult) {
  const fallbackKeyPoints = deriveSnippetKeyPoints(result.snippet);
  let extractedTitle: string | null = null;
  let extractedSiteName: string | null = null;
  let extractedMarkdown = "";
  let factExtract: ArticleCard["factExtract"] = null;

  try {
    const extracted = await withTimeout(
      extractResearchSource(result.url),
      20_000,
      () => ({
        markdown: "",
        title: null,
        sourceName: null,
        publishedAt: result.publishedAt,
      })
    );
    extractedTitle = extracted.title ?? null;
    extractedSiteName = extracted.sourceName ?? null;
    extractedMarkdown = extracted.markdown.trim();

    if (extractedMarkdown.length >= 600) {
      try {
        const extractedFacts = await extractArticleFactsFromMarkdown({
          sourceUrl: result.url,
          title: extracted.title ?? result.title,
          siteName: extracted.sourceName,
          markdown: trimToLength(extractedMarkdown, 18_000),
        });
        factExtract = extractedFacts.facts;
      } catch {
        // Best-effort section article extraction.
      }
    }
  } catch {
    // Best-effort section article extraction.
  }

  const keyPoints = dedupeBy(
    [
      ...(factExtract?.keyFacts ?? []),
      ...(factExtract?.operationalDetails ?? []),
      ...(factExtract?.motiveFrames ?? []),
      ...(factExtract?.namedActors ?? []),
      ...fallbackKeyPoints,
    ],
    (item) => item
  ).slice(0, 5);

  const role = classifyArticleRole({
    title: result.title,
    url: result.url,
    source: result.source,
    role: "background",
    snippet: result.snippet,
    publishedAt: result.publishedAt,
    contentLength: extractedMarkdown.length,
    extractedTitle,
    extractedSiteName,
    factExtract,
    error: null,
  });

  return {
    title: extractedTitle ?? result.title,
    url: result.url,
    source: result.source,
    role,
    snippet:
      keyPoints[0] ??
      result.snippet.trim() ??
      `Section source extracted for ${extractedTitle ?? result.title}.`,
    publishedAt: result.publishedAt,
    keyPoints,
  } satisfies SectionClipPackage["relatedArticles"][number];
}

async function discoverSectionSourceBundles(args: {
  title: string;
  briefText: string | null;
  deepResearch: DeepResearchCard | null;
  outlineStage: ScriptOutlineStage;
  sectionQueryPlans: SectionQueryPlan[];
}) {
  const bundles: SectionSourceBundle[] = [];

  for (const [index, section] of args.outlineStage.sections.entries()) {
    const queryPlan =
      args.sectionQueryPlans.find((plan) => plan.sectionHeading === section.heading)
      ?? args.sectionQueryPlans[index]
      ?? {
        sectionHeading: section.heading,
        articleQueries: [],
        mediaQueries: [],
        socialQueries: [],
      };

    const sectionKeywords = buildSectionKeywords([
      section.heading,
      section.purpose,
      section.beatGoal,
      ...section.evidenceSlots,
    ]);

    const articleResults = await withTimeout(
      searchResearchSources({
        query: `${args.title} ${section.heading} article research`,
        searchQueries: queryPlan.articleQueries,
        objective: [
          `Find the best article and document sources for this documentary section: ${section.heading}.`,
          `Story title: ${args.title}`,
          `Section purpose: ${section.purpose}`,
          `Beat goal: ${section.beatGoal}`,
          args.briefText ? `Editorial brief excerpt:\n${trimToLength(args.briefText, 600)}` : null,
          args.deepResearch?.content
            ? `Parallel deep research memo excerpt:\n${trimToLength(args.deepResearch.content, 1000)}`
            : null,
          "Prefer official sources, major reporting, academic or institutional material, and sources that give clean key facts for the section.",
          "Avoid SEO farms and duplicate wrappers.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        mode: "fast",
        limit: 8,
        maxCharsPerResult: 700,
        maxCharsTotal: 3200,
      }),
      30_000,
      () => []
    );

    const mediaResults = await withTimeout(
      searchResearchSources({
        query: `${args.title} ${section.heading} media research`,
        searchQueries: queryPlan.mediaQueries,
        objective: [
          `Find the strongest direct videos, interviews, lectures, hearings, or news segments for this documentary section: ${section.heading}.`,
          `Story title: ${args.title}`,
          `Section purpose: ${section.purpose}`,
          `Beat goal: ${section.beatGoal}`,
          args.briefText ? `Editorial brief excerpt:\n${trimToLength(args.briefText, 320)}` : null,
          "Prefer source video, official channels, reporters, hearings, documentaries, podcasts, and institutional uploads over commentary wrappers.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        mode: "fast",
        limit: 8,
        maxCharsPerResult: 700,
        maxCharsTotal: 3200,
      }),
      30_000,
      () => []
    );

    const socialResults = await withTimeout(
      searchResearchSources({
        query: `${args.title} ${section.heading} social research`,
        searchQueries: queryPlan.socialQueries,
        objective: [
          `Find the strongest social proof for this documentary section: ${section.heading}.`,
          `Story title: ${args.title}`,
          `Section purpose: ${section.purpose}`,
          args.briefText ? `Editorial brief excerpt:\n${trimToLength(args.briefText, 320)}` : null,
          "Prefer Reddit teacher/parent threads, direct educator posts, and high-signal X posts over junk social landing pages.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        mode: "fast",
        limit: 8,
        maxCharsPerResult: 500,
        maxCharsTotal: 2400,
      }),
      25_000,
      () => []
    );

    const articleSources = [];
    for (const result of dedupeBy(
      articleResults.filter(
        (item) =>
          !/youtube\.com|youtu\.be/i.test(item.url) &&
          scoreSectionTextMatch(`${item.title} ${item.snippet}`, sectionKeywords) >= 6
      ),
      (item) => item.url
    ).slice(0, 3)) {
      articleSources.push(await buildSectionArticleSource(result));
    }

    const clipSources = dedupeBy(
      mediaResults
        .map((result) => {
          const provider = inferSectionClipProvider(result.url);
          const assessment = assessMediaSourceCandidate({
            provider,
            title: result.title,
            sourceUrl: result.url,
            channelOrContributor: inferSectionClipContributor({
              url: result.url,
              title: result.title,
              snippet: result.snippet,
            }),
          });

          return {
            result,
            provider,
            assessment,
          };
        })
        .filter(({ assessment }) => !assessment.isLikelyCommentary)
        .sort(
          (left, right) =>
            right.result.relevanceScore +
            right.assessment.scoreAdjustment -
            (left.result.relevanceScore + left.assessment.scoreAdjustment)
        )
        .map(({ result, provider }) => ({
          title: result.title,
          provider,
          sourceUrl: result.url,
          channelOrContributor: inferSectionClipContributor({
            url: result.url,
            title: result.title,
            snippet: result.snippet,
          }),
          relevanceScore: result.relevanceScore,
        })),
      (item) => item.sourceUrl
    ).slice(0, 3);

    const socialSources = selectDiverseSocialPosts(
      dedupeBy(
        socialResults
          .filter(
            (item) =>
              !hasBrokenSocialSnippet(`${item.title}\n${item.snippet}`) &&
              (isValidSocialStatusUrl(item.url) ||
                isUsefulSocialProfileUrl(item.url) ||
                /reddit\.com/i.test(item.url))
          )
          .sort(
            (left, right) =>
              scoreSectionTextMatch(`${right.title} ${right.snippet}`, sectionKeywords) -
                scoreSectionTextMatch(`${left.title} ${left.snippet}`, sectionKeywords) ||
              right.relevanceScore - left.relevanceScore
          )
          .map((item) => ({
            title: item.title,
            url: item.url,
            snippet: item.snippet,
            publishedAt: item.publishedAt,
            relevanceScore: item.relevanceScore,
          })),
        (item) => item.url
      ),
      3
    );

    bundles.push({
      sectionHeading: section.heading,
      articleSources,
      clipSources,
      socialSources,
    });
  }

  return bundles;
}

function buildSectionSourceResearchAppendix(sectionSourceBundles: SectionSourceBundle[]) {
  if (sectionSourceBundles.length === 0) {
    return "";
  }

  const blocks = sectionSourceBundles.map((bundle, index) =>
    [
      `Section source packet ${index + 1}: ${bundle.sectionHeading}`,
      bundle.articleSources.length > 0
        ? `Article sources:\n${bundle.articleSources
            .map(
              (article) =>
                `- ${article.title}\n  URL: ${article.url}\n  Key points: ${article.keyPoints.join(" | ") || article.snippet}`
            )
            .join("\n")}`
        : "Article sources: none surfaced",
      bundle.clipSources.length > 0
        ? `Video sources:\n${bundle.clipSources
            .map(
              (clip) =>
                `- ${clip.title}\n  URL: ${clip.sourceUrl}${clip.channelOrContributor ? `\n  Channel: ${clip.channelOrContributor}` : ""}`
            )
            .join("\n")}`
        : "Video sources: none surfaced",
      bundle.socialSources.length > 0
        ? `Social sources:\n${bundle.socialSources
            .map(
              (social) =>
                `- ${social.title}\n  URL: ${social.url}\n  Snippet: ${trimToLength(social.snippet, 220)}`
            )
            .join("\n")}`
        : "Social sources: none surfaced",
    ].join("\n")
  );

  return trimToLength(
    ["Section research packets (use these for the final outline and section planning):", ...blocks].join(
      "\n\n"
    ),
    16_000
  );
}

async function generateFinalOutlineStage(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  targetWordRange: { targetWords: number; minWords: number; maxWords: number };
  draftOutlineStage: ScriptOutlineStage;
}) {
  return createAnthropicJson({
    schema: scriptOutlineStageSchema,
    model: getAnthropicWritingModel(),
    system: [
      "You are the final outline stage of a documentary script agent.",
      "You are refining a draft outline after section-level research packets have been collected.",
      "Keep the same section count and preserve the same broad section order.",
      "Prefer keeping the existing headings unless the wording truly needs tightening.",
      "Use the section research packets to make the evidence slots concrete and source-aware.",
      "Each section should clearly imply article receipts, clip targets, quote opportunities, or social proof where relevant.",
      "Return JSON only.",
    ].join(" "),
    user: [
      args.researchPacket,
      "Structured research stage:",
      JSON.stringify(args.researchStage, null, 2),
      "Draft outline to refine:",
      args.draftOutlineStage.sections
        .map(
          (section, index) =>
            `${index + 1}. ${section.heading}\npurpose: ${section.purpose}\nbeat goal: ${section.beatGoal}\ntarget words: ${section.targetWordCount}\nevidence: ${section.evidenceSlots.join(" | ")}`
        )
        .join("\n\n"),
      `Keep section count exactly ${args.draftOutlineStage.sections.length}.`,
      `Aim for about ${args.targetWordRange.targetWords} words total, with the final script landing in the ${args.targetWordRange.minWords}-${args.targetWordRange.maxWords} range.`,
      "Return JSON with:",
      "{",
      '  "sections": [',
      "    {",
      '      "heading": "section name",',
      '      "purpose": "what this section does",',
      '      "beatGoal": "what the viewer should feel/learn",',
      '      "targetWordCount": 250,',
      '      "evidenceSlots": ["specific source-aware receipt", "specific clip or quote need"]',
      "    }",
      "  ]",
      "}",
    ].join("\n\n"),
    temperature: 0.3,
    maxTokens: 2800,
  });
}

function isValidSocialStatusUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (!/(^|\.)(x\.com|twitter\.com)$/.test(host)) {
      return false;
    }
    const path = parsed.pathname.replace(/\/+$/, "");
    return /^\/(?:[^/]+|i)\/status\/\d+$/i.test(path);
  } catch {
    return false;
  }
}

function isUsefulSocialProfileUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (!/(^|\.)(x\.com|twitter\.com)$/.test(host)) {
      return false;
    }
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!/^\/[^/]+$/i.test(path)) {
      return false;
    }
    const reserved = new Set(["/home", "/i", "/explore", "/search", "/login", "/signup"]);
    return !reserved.has(path.toLowerCase());
  } catch {
    return false;
  }
}

function hasBrokenSocialSnippet(text: string) {
  return /join today|sign up with google|terms of service|privacy policy|cookie use|happening now|condiciones de servicio|pol[ií]tica de privacidad|pol[ií]tica de cookies|accesibilidad|informaci[oó]n de anuncios|m[aá]s opciones/i.test(
    text
  );
}

function adaptSocialQueryForXSearch(query: string) {
  return query
    .replace(/\bsite:(?:x\.com|twitter\.com|reddit\.com)\b/gi, " ")
    .replace(/\breddit\b/gi, " ")
    .replace(/\br\/[A-Za-z0-9_]+\b/g, " ")
    .replace(/\btiktok\b/gi, " ")
    .replace(/\btwitter\b/gi, " ")
    .replace(/\bx\.com\b/gi, " ")
    .replace(/\bstatus\b/gi, " ")
    .replace(/\btweets?\b/gi, " ")
    .replace(/\bposts?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreXPostRelevance(args: {
  viewCount: number;
  likeCount: number;
  retweetCount: number;
  text: string;
  query: string;
}) {
  const engagementSignal =
    (args.viewCount > 0 ? Math.log10(args.viewCount + 1) * 14 : 0)
    + (args.likeCount > 0 ? Math.log10(args.likeCount + 1) * 10 : 0)
    + (args.retweetCount > 0 ? Math.log10(args.retweetCount + 1) * 12 : 0);
  const queryBonus = scoreSectionTextMatch(`${args.text} ${args.query}`, tokenizeKeywords(args.query, 8));
  return Math.max(35, Math.min(100, Math.round(42 + engagementSignal + queryBonus)));
}

function getSocialSelectionMeta(url: string) {
  const normalized = normalizeExternalUrl(url) ?? url;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());

    if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) {
      const handle = parts[0] ?? "unknown";
      return {
        hostKey: "x",
        identityKey: `x:${handle}`,
        identityLimit: 1,
        hostLimit: 3,
      };
    }

    if (host === "reddit.com" || host.endsWith(".reddit.com")) {
      if (parts[0] === "r" && parts[1]) {
        return {
          hostKey: "reddit",
          identityKey: `reddit:r:${parts[1]}`,
          identityLimit: 1,
          hostLimit: 3,
        };
      }
      if (parts[0] === "user" && parts[1]) {
        return {
          hostKey: "reddit",
          identityKey: `reddit:user:${parts[1]}`,
          identityLimit: 1,
          hostLimit: 3,
        };
      }
      return {
        hostKey: "reddit",
        identityKey: "reddit:misc",
        identityLimit: 2,
        hostLimit: 3,
      };
    }

    return {
      hostKey: host || "unknown",
      identityKey: host || normalized.toLowerCase(),
      identityLimit: 1,
      hostLimit: 2,
    };
  } catch {
    return {
      hostKey: "unknown",
      identityKey: normalized.toLowerCase(),
      identityLimit: 1,
      hostLimit: 2,
    };
  }
}

function selectDiverseSocialPosts<T extends { url: string }>(items: T[], maxResults: number) {
  const candidates = dedupeBy(items, (item) => normalizeExternalUrl(item.url) ?? item.url);
  const selected: T[] = [];
  const identityCounts = new Map<string, number>();
  const hostCounts = new Map<string, number>();

  for (const pass of [0, 1]) {
    for (const item of candidates) {
      if (selected.includes(item)) {
        continue;
      }

      const meta = getSocialSelectionMeta(item.url);
      const identityLimit = meta.identityLimit + (pass === 1 && meta.hostKey === "x" ? 1 : 0);
      const hostLimit = meta.hostLimit + (pass === 1 ? 1 : 0);
      const identityCount = identityCounts.get(meta.identityKey) ?? 0;
      const hostCount = hostCounts.get(meta.hostKey) ?? 0;

      if (identityCount >= identityLimit || hostCount >= hostLimit) {
        continue;
      }

      selected.push(item);
      identityCounts.set(meta.identityKey, identityCount + 1);
      hostCounts.set(meta.hostKey, hostCount + 1);

      if (selected.length >= maxResults) {
        return selected;
      }
    }
  }

  return selected;
}

function condenseSearchPhrase(text: string) {
  const cleaned = text.replace(/["“”']/g, "").replace(/\s+/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.slice(0, 8).join(" ");
}

function normalizeForMatch(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTranscriptPassage(args: {
  segments: Array<{ text: string; startMs: number; durationMs: number }>;
  startIndex: number;
  maxWords?: number;
  maxWindowMs?: number;
}) {
  const maxWords = args.maxWords ?? 380;
  const maxWindowMs = args.maxWindowMs ?? 55_000;
  const startSegment = args.segments[args.startIndex];
  if (!startSegment) {
    return { text: "", endMs: null as number | null };
  }

  const collected: string[] = [];
  let wordCount = 0;
  let endMs = startSegment.startMs + (startSegment.durationMs || 5000);

  for (let index = args.startIndex; index < args.segments.length; index += 1) {
    const segment = args.segments[index];
    if (segment.startMs - startSegment.startMs > maxWindowMs) {
      break;
    }
    const cleaned = segment.text.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      continue;
    }

    collected.push(cleaned);
    wordCount += cleaned.split(/\s+/).filter(Boolean).length;
    endMs = segment.startMs + (segment.durationMs || 5000);

    if (wordCount >= maxWords) {
      break;
    }
    if (wordCount >= 45 && /[.!?]["')\]]?$/.test(cleaned)) {
      break;
    }
  }

  const text = collected.join(" ").replace(/\s+/g, " ").trim();
  return {
    text: wordCount > maxWords ? trimToLength(text, 3200) : text,
    endMs,
  };
}

function scoreNewsResultForReport(
  result: { title: string; url: string; snippet: string; source: string },
  storyKeywords: string[]
) {
  const host = getNormalizedHostname(result.url);
  const lowerTitle = result.title.toLowerCase();
  const lowerSnippet = result.snippet.toLowerCase();
  const combined = `${lowerTitle} ${lowerSnippet}`;

  let score = 0;
  for (const [knownHost, bonus] of Object.entries(STRONG_NEWS_HOST_BONUS)) {
    if (host === knownHost || host.endsWith(`.${knownHost}`)) {
      score += bonus;
      break;
    }
  }

  for (const pattern of LOW_VALUE_URL_PATTERNS) {
    if (pattern.test(result.url) || pattern.test(result.title)) {
      score -= 30;
    }
  }

  score += countKeywordHits(combined, storyKeywords) * 5;
  score += countKeywordHits(combined, TOPIC_SIGNAL_TERMS) * 4;
  if (lowerTitle.includes("supreme court")) score += 3;
  if (lowerTitle.includes("ordered to pay")) score += 6;
  if (lowerTitle.includes("rejects")) score += 2;

  return score;
}

function buildDocumentaryQuotePrompts(
  title: string,
  articleCards: ArticleCard[],
  briefText: string | null
) {
  const storyKeywords = tokenizeKeywords(title, 6);
  const namedTargets = dedupeBy(
    [
      ...(briefText ? extractEntityPhrases(briefText, 10) : []),
      ...articleCards.flatMap((article) => article.factExtract?.namedActors ?? []),
    ],
    (item) => item
  )
    .filter((item) => item.toLowerCase() !== title.toLowerCase())
    .slice(0, 6);
  const articleSignals = dedupeBy(
    articleCards.flatMap((article) => [
      ...(article.factExtract?.keyFacts ?? []),
      ...(article.factExtract?.operationalDetails ?? []),
      ...(article.factExtract?.motiveFrames ?? []),
      ...(article.factExtract?.relationshipTurns ?? []),
    ]),
    (item) => item
  )
    .slice(0, 6)
    .join(" | ");

  const contextParts = [
    briefText
      ? `Editorial angle: ${trimToLength(briefText.replace(/\s+/g, " ").trim(), 900)}`
      : null,
    articleSignals
      ? `Use these research signals while searching the transcript: ${articleSignals}`
      : `Use the core topic keywords while searching the transcript: ${storyKeywords.join(" | ")}`,
    namedTargets.length > 0
      ? `Prefer direct spoken material involving these recurring targets or names: ${namedTargets.join(
          " | "
        )}`
      : null,
  ].filter(Boolean);
  const context = contextParts.join("\n");

  return dedupeBy(
    [
      {
        lineText: `Find the strongest direct quote where the speaker says plainly what other people in media or entertainment were avoiding about ${title}.`,
        scriptContext: context,
      },
      {
        lineText: `Find the cleanest direct quote where the speaker names, mocks, or goes after a powerful person, taboo figure, or protected celebrity tied to ${title}.`,
        scriptContext: context,
      },
      {
        lineText: `Find the cleanest direct quote that shows the cost, punishment, outsider status, or consequence of the approach surrounding ${title}.`,
        scriptContext: context,
      },
      {
        lineText: `Find the cleanest direct quote that states the central claim, allegation, or framing at the heart of ${title}.`,
        scriptContext: context,
      },
      {
        lineText: `Find the cleanest direct quote where the speaker admits, clarifies, retracts, or reveals the consequences surrounding ${title}.`,
        scriptContext: context,
      },
      ...namedTargets.map((entity) => ({
        lineText: `Find the strongest direct quote about ${entity} that supports the documentary angle for ${title}.`,
        scriptContext: context,
      })),
    ],
    (item) => item.lineText
  ).slice(0, 8);
}

function buildQuoteDrivenMediaQueries(
  title: string,
  articleCards: ArticleCard[],
  storyKeywords: string[]
) {
  const anchor = storyKeywords.slice(0, 3).join(" ").trim() || title;
  const candidates = dedupeBy(
    articleCards.flatMap((article) => [
      ...(article.factExtract?.exactQuotes ?? []),
      ...(article.factExtract?.keyFacts ?? []),
      ...(article.factExtract?.operationalDetails ?? []),
    ]),
    (item) => item
  )
    .map((candidate) => candidate.replace(/\s+/g, " ").trim())
    .filter((candidate) => candidate.length >= 18 && candidate.length <= 140)
    .sort((left, right) => {
      const scoreLeft =
        countKeywordHits(left, storyKeywords) * 8 +
        countKeywordHits(left, STRONG_QUOTE_TERMS) * 6 +
        (STRONG_FACT_PATTERNS.some((pattern) => pattern.test(left)) ? 20 : 0);
      const scoreRight =
        countKeywordHits(right, storyKeywords) * 8 +
        countKeywordHits(right, STRONG_QUOTE_TERMS) * 6 +
        (STRONG_FACT_PATTERNS.some((pattern) => pattern.test(right)) ? 20 : 0);
      return scoreRight - scoreLeft;
    })
    .slice(0, 3);

  return candidates.map((candidate) => `${anchor} "${condenseSearchPhrase(candidate)}"`);
}

function buildTranscriptNeedlePhrases(
  articleCards: ArticleCard[],
  storyKeywords: string[],
  briefText: string | null
) {
  const candidates = dedupeBy(
    articleCards.flatMap((article) => [
      ...(article.factExtract?.exactQuotes ?? []),
      ...(article.factExtract?.keyFacts ?? []),
      ...(article.factExtract?.operationalDetails ?? []),
    ]),
    (item) => item
  )
    .map((candidate) => candidate.replace(/\s+/g, " ").trim())
    .filter((candidate) => candidate.length >= 18 && candidate.length <= 180);

  const phrases: string[] = [];

  for (const candidate of candidates) {
    const words = normalizeForMatch(candidate).split(" ").filter(Boolean);
    if (words.length < 4) {
      continue;
    }

    for (let size = 6; size >= 4; size -= 1) {
      for (let index = 0; index <= words.length - size; index += 1) {
        const phrase = words.slice(index, index + size).join(" ");
        const score =
          countKeywordHits(phrase, storyKeywords) * 8 +
          countKeywordHits(phrase, STRONG_QUOTE_TERMS) * 10 +
          (STRONG_FACT_PATTERNS.some((pattern) => pattern.test(phrase)) ? 20 : 0);
        if (score >= 18) {
          phrases.push(phrase);
        }
      }
    }
  }

  const phraseCandidates = dedupeBy(
    phrases.sort((left, right) => {
      const scoreLeft =
        countKeywordHits(left, storyKeywords) * 8 +
        countKeywordHits(left, STRONG_QUOTE_TERMS) * 10;
      const scoreRight =
        countKeywordHits(right, storyKeywords) * 8 +
        countKeywordHits(right, STRONG_QUOTE_TERMS) * 10;
      return scoreRight - scoreLeft;
    }),
    (phrase) => phrase
  ).slice(0, 8);

  const entityPhrases = dedupeBy(
    [
      ...extractEntityPhrases(briefText ?? "", 12),
      ...articleCards.flatMap((article) => article.factExtract?.namedActors ?? []),
      ...storyKeywords,
    ]
      .flatMap((candidate) => {
        const normalized = normalizeForMatch(candidate);
        if (!normalized || normalized.length < 3) {
          return [];
        }
        const words = normalized.split(" ").filter(Boolean);
        return dedupeBy(
          [
            normalized,
            words.slice(-1).join(" "),
            words.slice(0, 2).join(" "),
            words.slice(-2).join(" "),
          ].filter((item) => item && item.length >= 3),
          (item) => item
        );
      }),
    (item) => item
  ).slice(0, 12);

  return dedupeBy([...phraseCandidates, ...entityPhrases], (phrase) => phrase).slice(0, 16);
}

function findAnchoredTranscriptQuotes(args: {
  sourceLabel: string;
  sourceUrl: string;
  segments: Array<{ text: string; startMs: number; durationMs: number }>;
  needlePhrases: string[];
}) {
  const quotes: TranscriptQuoteCard[] = [];

  for (let index = 0; index < args.segments.length; index += 1) {
    const window = args.segments.slice(index, index + 5);
    const windowText = window.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").trim();
    const normalizedWindow = normalizeForMatch(windowText);

    for (const needle of args.needlePhrases) {
      if (!normalizedWindow.includes(needle)) {
        continue;
      }
      if (isProceduralTranscriptQuote(windowText)) {
        continue;
      }

      const passage = buildTranscriptPassage({
        segments: args.segments,
        startIndex: index,
      });
      if (!passage.text) {
        continue;
      }

      quotes.push({
        sourceLabel: args.sourceLabel,
        sourceUrl: `${args.sourceUrl}${args.sourceUrl.includes("?") ? "&" : "?"}t=${Math.floor(
          args.segments[index].startMs / 1000
        )}`,
        quoteText: passage.text,
        speaker: null,
        context: `Long transcript window anchored to research phrase: ${needle}`,
        startMs: args.segments[index].startMs,
        endMs: passage.endMs,
        relevanceScore: 100 + needle.split(" ").length * 4,
      });
      break;
    }
  }

  return dedupeBy(quotes, (quote) => `${quote.sourceUrl}|${quote.quoteText}`).slice(0, 4);
}

function isProceduralTranscriptQuote(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 36 || normalized.length > 3200) {
    return true;
  }

  if (PROCEDURAL_QUOTE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const alphaChars = (normalized.match(/[A-Za-z]/g) ?? []).length;
  if (alphaChars / normalized.length < 0.55) {
    return true;
  }

  if ((normalized.match(/\b(?:okay|yeah|uh|um|mr)\b/gi) ?? []).length >= 4) {
    return true;
  }

  if (normalized.includes("...")) {
    return true;
  }
  if (normalized.includes("…")) {
    return true;
  }
  if (/\bobjection\b/i.test(normalized)) {
    return true;
  }
  if (/\basking him\b/i.test(normalized)) {
    return true;
  }
  if (/\brepeat a quote\b/i.test(normalized)) {
    return true;
  }
  if (/\bdo you see\b/i.test(normalized)) {
    return true;
  }
  if (/\blet me show\b/i.test(normalized)) {
    return true;
  }
  if (/\byou concluded\b/i.test(normalized)) {
    return true;
  }
  if (/\byou will admit\b/i.test(normalized)) {
    return true;
  }
  if (/\bi want to play you\b/i.test(normalized)) {
    return true;
  }
  if (/\bplay you a video clip\b/i.test(normalized)) {
    return true;
  }
  if (/\bwe play the video\b/i.test(normalized)) {
    return true;
  }
  if (/^\s*(jones|mr jones)\b/i.test(normalized)) {
    return true;
  }
  if (/^\s*that'?s rule\b/i.test(normalized)) {
    return true;
  }
  if (/\baffidavit\b/i.test(normalized)) {
    return true;
  }
  if (/\bobjective form\b/i.test(normalized)) {
    return true;
  }
  if (/\bcorrect\b/i.test(normalized) && /\byou\b/i.test(normalized)) {
    return true;
  }

  return false;
}

function hasWeakQuoteLead(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);

  if (words.length < 4) {
    return true;
  }

  const contentWords = words.filter((word) => !QUOTE_LEADIN_STOPWORDS.has(word));
  return contentWords.length < 2;
}

function isNarratedTranscriptQuote(quote: TranscriptQuoteCard) {
  const normalized = quote.quoteText.replace(/\s+/g, " ").trim().toLowerCase();
  if (NARRATED_QUOTE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  if (
    !quote.speaker &&
    /\b(jury|attorney|court today|backtracking|victim|mother|father)\b/i.test(normalized) &&
    !/\bi\b/.test(normalized)
  ) {
    return true;
  }
  return false;
}

function scoreTranscriptQuoteForReport(
  quote: TranscriptQuoteCard,
  storyKeywords: string[]
) {
  const normalized = quote.quoteText.replace(/\s+/g, " ").trim();
  if (isProceduralTranscriptQuote(normalized)) {
    return -999;
  }
  if (isNarratedTranscriptQuote(quote)) {
    return -999;
  }
  if (
    PROCEDURAL_SOURCE_PATTERNS.some((pattern) => pattern.test(quote.sourceLabel)) &&
    !STRONG_FACT_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return -999;
  }

  let score = quote.relevanceScore;

  score += countKeywordHits(normalized, storyKeywords) * 10;
  score += countKeywordHits(normalized, STRONG_QUOTE_TERMS) * 6;
  if (/\b(o\.?j\.?|simpson|cosby|clinton|michael jackson|jackson)\b/i.test(normalized)) score += 12;
  if (/100%\s*real/i.test(normalized)) score += 20;
  if (/synthetic|fake|actors|hoax/i.test(normalized)) score += 12;
  if (/admit|admitted|wrong|lied|apolog/i.test(normalized)) score += 10;
  if (/sandy hook/i.test(normalized)) score += 15;
  if (/parents|families/i.test(normalized)) score += 8;
  if (/court correct|mr\.|exhibit|double-sided/i.test(normalized)) score -= 40;
  if (hasWeakQuoteLead(normalized)) score -= 30;
  if (
    COMMENTARY_SOURCE_PATTERNS.some((pattern) => pattern.test(quote.sourceLabel)) &&
    !/\b(o\.?j\.?|simpson|cosby|clinton|michael jackson|jackson)\b/i.test(normalized)
  ) {
    score -= 22;
  } else if (COMMENTARY_SOURCE_PATTERNS.some((pattern) => pattern.test(quote.sourceLabel))) {
    score -= 8;
  }
  if (PROCEDURAL_SOURCE_PATTERNS.some((pattern) => pattern.test(quote.sourceLabel))) score -= 30;
  if (PREFERRED_DIRECT_SOURCE_PATTERNS.some((pattern) => pattern.test(quote.sourceLabel))) score += 14;

  return score;
}

function classifyArticleRole(article: ArticleCard) {
  const text = `${article.title} ${article.snippet}`.toLowerCase();
  if (/hoax|fake|actors|admit|admission|said|broadcast|show|infowars/.test(text)) {
    return "core_receipts";
  }
  if (/platform|supplement|revenue|business|audience/.test(text)) {
    return "system";
  }
  if (/appeal|judgment|defamation|trial|lawsuit|verdict|bankruptcy|supreme court/.test(text)) {
    return "legal";
  }
  return "background";
}

function scoreMediaClipForReport(
  clip: {
    title: string;
    channelOrContributor?: string | null;
    provider?: string | null;
    sourceUrl?: string | null;
    relevanceScore: number;
  },
  storyKeywords: string[]
) {
  const label = `${clip.title} ${clip.channelOrContributor ?? ""}`.toLowerCase();
  const sourceAssessment = assessMediaSourceCandidate({
    provider: clip.provider,
    title: clip.title,
    sourceUrl: clip.sourceUrl,
    channelOrContributor: clip.channelOrContributor,
  });
  let score =
    clip.relevanceScore +
    countKeywordHits(label, storyKeywords) * 8 +
    countKeywordHits(label, STRONG_QUOTE_TERMS) * 6 +
    sourceAssessment.scoreAdjustment;

  if (sourceAssessment.isLikelyCommentary) score -= 24;
  if (PROCEDURAL_SOURCE_PATTERNS.some((pattern) => pattern.test(label))) score -= 28;
  if (sourceAssessment.isLikelyPrimary) score += 10;
  if (PREFERRED_DIRECT_SOURCE_PATTERNS.some((pattern) => pattern.test(label))) score += 20;
  if (/alex jones|infowars/i.test(label)) score += 8;
  if (/government operation|inside job|100%\s*real|crisis actors|hoax/i.test(label)) score += 16;

  return score;
}

async function collectTranscriptQuotesForClip(args: {
  clip: {
    title: string;
    sourceUrl: string;
    provider: string;
  };
  segments: Array<{ text: string; startMs: number; durationMs: number }>;
  quotePrompts: Array<{ lineText: string; scriptContext: string }>;
  needlePhrases: string[];
  storyKeywords: string[];
}) {
  const collected: TranscriptQuoteCard[] = [];

  const anchoredQuotes = findAnchoredTranscriptQuotes({
    sourceLabel: args.clip.title,
    sourceUrl: args.clip.sourceUrl,
    segments: args.segments,
    needlePhrases: args.needlePhrases,
  });
  collected.push(...anchoredQuotes);

  const combinedPromptText = args.quotePrompts
    .map((prompt) => `- ${prompt.lineText}`)
    .join("\n");
  const combinedScriptContext = [
    args.quotePrompts[0]?.scriptContext ?? "",
    "Focus on these editorial needs in one pass:",
    combinedPromptText,
    "Only return direct spoken material from the main speaker or a clean replay of that speaker's words. Do not return narration, legal procedure, host chatter, or wrapper commentary.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const quotes = await findRelevantQuotes({
    lineText: `Extract the strongest documentary-ready verbatim passages from this clip for the story.`,
    scriptContext: combinedScriptContext,
    transcript: args.segments,
    videoTitle: args.clip.title,
    maxQuotes: 5,
  }).catch(() => []);

  for (const quote of quotes) {
    collected.push({
      sourceLabel: args.clip.title,
      sourceUrl:
        args.clip.provider === "youtube"
          ? `${args.clip.sourceUrl}${args.clip.sourceUrl.includes("?") ? "&" : "?"}t=${Math.floor(
              quote.startMs / 1000
            )}`
          : args.clip.sourceUrl,
      quoteText: quote.quoteText,
      speaker: quote.speaker,
      context: quote.context,
      startMs: quote.startMs,
      endMs: quote.endMs,
      relevanceScore: quote.relevanceScore,
    });
  }

  return dedupeBy(
    collected
      .map((quote) => ({
        ...quote,
        relevanceScore: scoreTranscriptQuoteForReport(quote, args.storyKeywords),
      }))
      .filter((quote) => quote.relevanceScore >= 78)
      .sort((left, right) => right.relevanceScore - left.relevanceScore),
    (quote) => `${quote.sourceUrl}|${quote.startMs}|${quote.quoteText}`
  ).slice(0, 5);
}

function trimToLength(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimestamp(startMs: number | null | undefined) {
  if (typeof startMs !== "number" || startMs < 0) {
    return "";
  }
  const totalSeconds = Math.floor(startMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildResearchText(args: {
  title: string;
  briefText: string | null;
  deepResearch: DeepResearchCard | null;
  articleQueries: string[];
  mediaQueries: string[];
  articleCards: ArticleCard[];
  socialPosts: SocialPostCard[];
  discoveredClips: DiscoveredClipCard[];
  transcriptQuotes: TranscriptQuoteCard[];
}) {
  const orderedArticleCards = [...args.articleCards].sort((left, right) => {
    const order = {
      core_receipts: 0,
      system: 1,
      legal: 2,
      background: 3,
    };
    return order[classifyArticleRole(left)] - order[classifyArticleRole(right)];
  });

  const parts: string[] = [
    `Headline-only research build for: ${args.title}`,
    args.briefText ? `Editorial brief:\n${args.briefText}` : null,
    args.deepResearch?.content
      ? `Parallel deep research memo:\n${trimToLength(args.deepResearch.content, 12_000)}`
      : null,
    `Article queries used: ${args.articleQueries.join(" | ")}`,
    `Media queries used: ${args.mediaQueries.join(" | ")}`,
    "",
    "Transcript-backed quotes (highest-value evidence):",
  ].filter(Boolean) as string[];

  if (args.transcriptQuotes.length === 0) {
    parts.push("None captured.");
  } else {
    for (const quote of args.transcriptQuotes) {
      parts.push(
        [
          `Source: ${quote.sourceLabel}`,
          `URL: ${quote.sourceUrl}`,
          quote.startMs != null ? `Timestamp: ${formatTimestamp(quote.startMs)}` : null,
          `Quote: ${quote.quoteText}`,
          quote.context ? `Context: ${quote.context}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
      parts.push("");
    }
  }

  if (args.discoveredClips.length > 0) {
    parts.push("Discovered media clips:");
    for (const clip of args.discoveredClips) {
      parts.push(
        [
          `Clip: ${clip.title}`,
          `Provider: ${clip.provider}`,
          clip.channelOrContributor ? `Channel: ${clip.channelOrContributor}` : null,
          `URL: ${clip.sourceUrl}`,
          `Relevance: ${Math.round(clip.relevanceScore)}`,
        ]
          .filter(Boolean)
          .join("\n")
      );
      parts.push("");
    }
  }

  if (args.socialPosts.length > 0) {
    parts.push("Notable social posts / tweet leads:");
    for (const post of args.socialPosts) {
      parts.push(
        [
          `Post: ${post.title}`,
          `URL: ${post.url}`,
          post.publishedAt ? `Published: ${post.publishedAt}` : null,
          post.snippet ? `Snippet: ${post.snippet}` : null,
          `Relevance: ${Math.round(post.relevanceScore)}`,
        ]
          .filter(Boolean)
          .join("\n")
      );
      parts.push("");
    }
  }

  parts.push("Organized article research:");

  for (const article of orderedArticleCards) {
    parts.push(
      [
        `Role: ${classifyArticleRole(article)}`,
        `Source: ${article.title}`,
        `URL: ${article.url}`,
        article.publishedAt ? `Published: ${article.publishedAt}` : null,
        article.snippet ? `Snippet: ${article.snippet}` : null,
        article.factExtract
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
        article.factExtract?.relationshipTurns?.length
          ? `Relationship turns: ${article.factExtract.relationshipTurns.join(" | ")}`
          : null,
        article.factExtract?.deterrents?.length
          ? `Deterrents: ${article.factExtract.deterrents.join(" | ")}`
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

  return trimToLength(parts.join("\n"), 48_000);
}

const whyItMattersStageSchema = z.object({
  whyItMattersNow: z.string().trim().min(1),
  modernDayRelevance: z.array(z.string().trim().min(1)).min(2).max(6),
  tweetWatchlist: z.array(z.string().trim().min(1)).max(6).default([]),
});

async function discoverSocialPosts(args: {
  title: string;
  briefText: string | null;
  articleCards: ArticleCard[];
  deepResearch: DeepResearchCard | null;
  socialQueries?: string[];
}) {
  const deepResearchEntities = args.deepResearch?.content
    ? extractEntityPhrases(args.deepResearch.content, 6)
    : [];
  const queryTerms = dedupeBy(
    [
      ...(args.socialQueries ?? []),
      `${args.title} twitter status`,
      `${args.title} tweets`,
      `${args.title} famous tweet`,
      `${args.title} site:twitter.com status`,
      `${args.title} site:x.com status`,
      ...(args.articleCards[0]?.factExtract?.namedActors ?? [])
        .slice(0, 2)
        .flatMap((actor) => [
          `${args.title} ${actor} twitter status`,
          `${args.title} ${actor} x.com status`,
        ]),
      ...deepResearchEntities.flatMap((entity) => [
        `${args.title} ${entity} tweet`,
        `${args.title} ${entity} x.com status`,
      ]),
    ],
    (item) => item
  ).slice(0, 8);

  const temporalContext = [args.title, args.briefText ?? "", args.deepResearch?.content ?? ""]
    .filter(Boolean)
    .join(" ");

  const xQueries = dedupeBy(
    queryTerms
      .map((query) => adaptSocialQueryForXSearch(query))
      .filter((query) => query.length >= 6),
    (query) => query
  ).slice(0, 5);
  const excludedHandles = new Set<string>();
  const xaiPosts: SocialPostCard[] = [];

  for (const query of xQueries) {
    try {
      const { results } = await searchTwitterPosts({
        query,
        temporalContext,
        maxResults: 4,
        excludedHandles: Array.from(excludedHandles),
      });

      for (const result of results) {
        if (!isValidSocialStatusUrl(result.postUrl) || hasBrokenSocialSnippet(result.text)) {
          continue;
        }

        const normalizedHandle = result.username.trim().replace(/^@+/, "").toLowerCase();
        if (normalizedHandle) {
          excludedHandles.add(normalizedHandle);
        }

        xaiPosts.push({
          title: `${result.displayName || result.username} on X`,
          url: result.postUrl,
          snippet: result.text,
          publishedAt: result.postedAt,
          relevanceScore: scoreXPostRelevance({
            viewCount: result.viewCount,
            likeCount: result.likeCount,
            retweetCount: result.retweetCount,
            text: result.text,
            query,
          }),
        });
      }
    } catch {
      continue;
    }
  }

  const results = await searchResearchSources({
    query: `${args.title} tweets and social posts`,
    searchQueries: queryTerms,
    objective: [
      `Find the most notable tweets, X posts, or archived social posts related to: ${args.title}.`,
      args.briefText ? `Editorial brief:\n${args.briefText}` : null,
      "Prefer original post URLs on x.com or twitter.com, or reliable archived pages that quote the original text.",
      "Return posts that are culturally memorable, widely cited, or directly useful to a documentary script.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    mode: "fast",
    limit: 12,
    maxCharsPerResult: 900,
    maxCharsTotal: 5000,
  }).catch(() => []);

  const statusPosts = dedupeBy(
    results
      .filter(
        (item) =>
          isValidSocialStatusUrl(item.url) &&
          !hasBrokenSocialSnippet(`${item.title}\n${item.snippet}`)
      )
      .map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        publishedAt: item.publishedAt,
        relevanceScore: item.relevanceScore,
      })),
    (item) => item.url
  ).sort((left, right) => right.relevanceScore - left.relevanceScore);

  const redditPosts = dedupeBy(
    results
      .filter(
        (item) =>
          /reddit\.com/i.test(item.url) &&
          !hasBrokenSocialSnippet(`${item.title}\n${item.snippet}`)
      )
      .map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        publishedAt: item.publishedAt,
        relevanceScore: item.relevanceScore,
      })),
    (item) => item.url
  ).sort((left, right) => right.relevanceScore - left.relevanceScore);

  const profilePosts = dedupeBy(
    results
      .filter(
        (item) =>
          isUsefulSocialProfileUrl(item.url) &&
          !hasBrokenSocialSnippet(`${item.title}\n${item.snippet}`)
      )
      .map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        publishedAt: item.publishedAt,
        relevanceScore: item.relevanceScore,
      })),
    (item) => item.url
  ).sort((left, right) => right.relevanceScore - left.relevanceScore);

  return selectDiverseSocialPosts(
    [
      ...xaiPosts.sort((left, right) => right.relevanceScore - left.relevanceScore),
      ...statusPosts,
      ...redditPosts,
      ...profilePosts,
    ],
    statusPosts.length > 0 ? 8 : 6
  );
}

async function generateWhyItMattersStage(args: {
  title: string;
  briefText: string | null;
  deepResearch: DeepResearchCard | null;
  researchStage: Awaited<ReturnType<typeof generateResearchStage>>;
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
  outlineStage: Awaited<ReturnType<typeof generateOutlineStage>>;
  quoteSelectionStage: ScriptQuoteSelectionStage;
  quotePlacementStage: ScriptQuotePlacementStage;
  sectionPlanStage: ScriptSectionPlanStage;
  sectionQueryPlans: SectionQueryPlan[];
  sectionSourceBundles: SectionSourceBundle[];
  discoveredClips: DiscoveredClipCard[];
  articleCards: ArticleCard[];
  socialPosts: SocialPostCard[];
  transcriptQuotes: TranscriptQuoteCard[];
}) {
  const selectedQuotesById = new Map(
    args.quoteSelectionStage.selectedQuotes.map((quote) => [quote.quoteId, quote] as const)
  );

  return args.sectionPlanStage.sections.map((sectionPlan, sectionIndex) => {
    const placement = args.quotePlacementStage.placements.find(
      (item) => item.sectionHeading === sectionPlan.sectionHeading
    );
    const outlineSection = args.outlineStage.sections.find(
      (section) => section.heading === sectionPlan.sectionHeading
    );
    const queryPlan =
      args.sectionQueryPlans.find((plan) => plan.sectionHeading === sectionPlan.sectionHeading)
      ?? args.sectionQueryPlans[sectionIndex]
      ?? null;
    const sourceBundle =
      args.sectionSourceBundles.find((bundle) => bundle.sectionHeading === sectionPlan.sectionHeading)
      ?? args.sectionSourceBundles[sectionIndex]
      ?? null;
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
          quoteText:
            args.transcriptQuotes.find(
              (item) =>
                item.sourceLabel === quote!.sourceTitle &&
                item.startMs === (quote!.startMs ?? null)
            )?.quoteText ?? quote!.quoteText,
          speaker:
            args.transcriptQuotes.find(
              (item) =>
                item.sourceLabel === quote!.sourceTitle &&
                item.startMs === (quote!.startMs ?? null)
            )?.speaker ?? quote!.speaker,
          context:
            args.transcriptQuotes.find(
              (item) =>
                item.sourceLabel === quote!.sourceTitle &&
                item.startMs === (quote!.startMs ?? null)
            )?.context ?? quote!.context,
          relevanceScore:
            args.transcriptQuotes.find(
              (item) =>
                item.sourceLabel === quote!.sourceTitle &&
                item.startMs === (quote!.startMs ?? null)
            )?.relevanceScore ?? quote!.relevanceScore,
          usageRole: quote!.usageRole,
          startMs: quote!.startMs,
          endMs:
            args.transcriptQuotes.find(
              (item) =>
                item.sourceLabel === quote!.sourceTitle &&
                item.startMs === (quote!.startMs ?? null)
            )?.endMs ?? quote!.endMs,
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

    const interestingClips = dedupeBy(
      [
        ...(sourceBundle?.clipSources ?? []),
        ...args.discoveredClips
          .filter((clip) =>
            exactQuotes.some((quote) => quote.sourceUrl && clip.sourceUrl.includes(String(quote.sourceUrl).replace(/.*watch\?v=/, ""))) ||
            transcriptQuotes.some((quote) => clip.sourceUrl.includes(String(quote.sourceUrl).replace(/.*watch\?v=/, ""))) ||
            exactQuotes.some((quote) => clip.title.toLowerCase().includes(quote.sourceTitle.toLowerCase().slice(0, 20))) ||
            clip.title.toLowerCase().includes(sectionPlan.sectionHeading.toLowerCase().split(" ")[0] ?? "")
          )
          .sort((left, right) => right.relevanceScore - left.relevanceScore),
      ],
      (clip) => clip.sourceUrl
    ).slice(0, 4);

    const relatedArticles = dedupeBy(
      [
        ...(sourceBundle?.articleSources ?? []),
        ...args.articleCards
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
      ],
      (article) => article.url
    ).slice(0, 4);

    const relatedSocialPosts = dedupeBy(
      [
        ...(sourceBundle?.socialSources ?? []),
        ...args.socialPosts
          .map((post) => ({
            post,
            score: scoreSectionTextMatch(`${post.title} ${post.snippet}`, sectionKeywords),
          }))
          .filter((item) => item.score >= 8)
          .sort((left, right) => right.score - left.score)
          .map(({ post }) => post),
      ],
      (post) => post.url
    ).slice(0, 3);

    const linkedEvidenceSlots = buildLinkedEvidenceSlots({
      evidenceSlots: outlineSection?.evidenceSlots ?? [],
      sectionKeywords,
      exactQuotes,
      transcriptQuotes,
      keyClipsToWatch: interestingClips,
      relatedArticles,
      relatedSocialPosts,
    });

    return {
      sectionHeading: sectionPlan.sectionHeading,
      narrativeRole: sectionPlan.narrativeRole,
      purpose: outlineSection?.purpose ?? "",
      beatGoal: outlineSection?.beatGoal ?? "",
      targetWordCount: outlineSection?.targetWordCount ?? null,
      queryPlan,
      evidenceSlots: outlineSection?.evidenceSlots ?? [],
      linkedEvidenceSlots,
      whyItMattersNow: outlineSection?.beatGoal ?? sectionPlan.narrativeRole,
      openingMove: sectionPlan.openingMove,
      closingMove: sectionPlan.closingMove,
      exactQuotes,
      transcriptQuotes,
      keyClipsToWatch: interestingClips,
      relatedArticles,
      relatedSocialPosts,
    };
  });
}

function inferSectionHintFromQuote(args: {
  quote: ScriptEvidenceQuote;
  sectionHeadings: string[];
  title: string;
}) {
  const text = `${args.quote.sourceTitle} ${args.quote.quoteText} ${args.quote.context}`.toLowerCase();
  const directHeading = args.sectionHeadings.find((heading) => {
    const firstWord = heading.toLowerCase().split(" ")[0] ?? "";
    return firstWord.length >= 4 && text.includes(firstWord);
  });
  if (directHeading) {
    return directHeading;
  }
  if (/\bo\.?j\.?|simpson\b/i.test(text)) {
    return args.sectionHeadings.find((heading) => /o\.?j|simpson|clearest example/i.test(heading)) ?? args.sectionHeadings[1] ?? args.sectionHeadings[0];
  }
  if (/\bclinton|cosby|jackson\b/i.test(text)) {
    return args.sectionHeadings.find((heading) => /pattern|untouchable|protected/i.test(heading)) ?? args.sectionHeadings[2] ?? args.sectionHeadings[0];
  }
  if (/\bfired|firing|ban|banned|ohlmeyer|snl|outsider|shabby\b/i.test(text)) {
    return args.sectionHeadings.find((heading) => /cost|firing|outsider/i.test(heading)) ?? args.sectionHeadings[4] ?? args.sectionHeadings[0];
  }
  if (/\blegacy|aged|matters now|reputation\b/i.test(text)) {
    return args.sectionHeadings[args.sectionHeadings.length - 1] ?? args.sectionHeadings[0];
  }
  return args.sectionHeadings[0] ?? args.title;
}

function buildFallbackResearchStage(args: {
  title: string;
  briefText: string | null;
  deepResearch: DeepResearchCard | null;
  articleCards: ArticleCard[];
  seedQuoteEvidence: ScriptEvidenceQuote[];
}): ScriptResearchStage {
  const namedTargets = dedupeBy(
    [
      ...(args.briefText ? extractEntityPhrases(args.briefText, 8) : []),
      ...args.articleCards.flatMap((article) => article.factExtract?.namedActors ?? []),
    ],
    (item) => item
  ).slice(0, 6);

  const thesis =
    args.briefText?.split(/\.\s+/).find((sentence) => sentence.trim().length > 24)?.trim() ??
    `${args.title} matters because the public persona hid a sharper story about instinct, truth, and the cost of refusing to flatter powerful people.`;

  const summary =
    args.deepResearch?.content
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .find((item) => item.length > 80)
      ?.slice(0, 1200) ??
    args.briefText ??
    `${args.title} is being framed through a research-first documentary packet without Claude stage generation.`;

  const keyClaims = dedupeBy(
    [
      thesis,
      namedTargets.length > 0
        ? `${args.title} repeatedly went after protected or culturally insulated figures like ${namedTargets.join(", ")}.`
        : null,
      "The core story is not just edgy comedy, but a pattern of saying the obvious thing while the rest of the entertainment world stayed careful.",
      "The second half of the story is the cost: punishment, friction, lost opportunities, and the outsider reputation that came from refusing to play the access game.",
      "The legacy matters now because instinctive comic honesty has aged better than the approval-seeking culture around it.",
    ].filter(Boolean) as string[],
    (item) => item
  ).slice(0, 6);

  return {
    summary,
    thesis,
    keyClaims,
    riskyClaims: [
      "Claims about motive or private industry retaliation should be framed carefully unless backed by direct quotes or reporting.",
    ],
    quoteEvidence: args.seedQuoteEvidence.slice(0, 12),
  };
}

function buildFallbackOutlineStage(args: {
  title: string;
  briefText: string | null;
}): ScriptOutlineStage {
  const targets = dedupeBy(extractEntityPhrases(args.briefText ?? "", 6), (item) => item);
  const clearestTarget =
    targets.find((target) => /o\.?j|simpson/i.test(target)) ??
    targets[0] ??
    "the clearest example";

  return {
    sections: [
      {
        heading: "The Joke Everyone Else Avoided",
        purpose: "Introduce the thesis that this was not just edgy comedy, but early truth-telling aimed at protected power.",
        beatGoal: "Open with the contrast between Norm's bluntness and the rest of entertainment culture's caution.",
        targetWordCount: 220,
        evidenceSlots: ["thesis clip", "legacy line", "modern relevance frame"],
      },
      {
        heading: `The ${clearestTarget} Campaign`,
        purpose: "Use the clearest recurring target as proof of method rather than just isolated provocation.",
        beatGoal: "Show how repetition turned the joke into a running indictment of celebrity protection and media denial.",
        targetWordCount: 260,
        evidenceSlots: ["direct clip", "best-known joke", "press reaction or fallout"],
      },
      {
        heading: "The Pattern Of Going After The Untouchables",
        purpose: "Expand from the clearest example into the broader pattern of Norm targeting powerful or protected figures.",
        beatGoal: "Move through Clinton, Cosby, Jackson, and similar names to prove this was an instinct, not a one-off obsession.",
        targetWordCount: 270,
        evidenceSlots: ["multi-target montage", "interview line", "archival context"],
      },
      {
        heading: "Why The Entertainment World Stayed Softer",
        purpose: "Contrast Norm's comic honesty with the access-driven caution of the rest of media and entertainment.",
        beatGoal: "Explain the system Norm was violating: access, insulation, softened language, and career management.",
        targetWordCount: 230,
        evidenceSlots: ["industry contrast", "commentary clip", "article receipt"],
      },
      {
        heading: "The Cost Of Refusing To Play Along",
        purpose: "Show the punishment, friction, and outsider status that came with not sanding down the material.",
        beatGoal: "Make the consequences concrete so the later legacy does not feel free or inevitable.",
        targetWordCount: 230,
        evidenceSlots: ["firing or ban receipt", "career-cost quote", "outsider line"],
      },
      {
        heading: "Why It Matters Now",
        purpose: "Land on modern relevance and explain why the reputation aged so well.",
        beatGoal: "Argue that Norm still matters because he valued instinct and truth over approval before that stance was culturally safe.",
        targetWordCount: 220,
        evidenceSlots: ["legacy quote", "modern-day relevance", "closing button"],
      },
    ],
  };
}

function buildFallbackQuoteSelectionStage(args: {
  title: string;
  quoteEvidence: ScriptEvidenceQuote[];
  outlineStage: ScriptOutlineStage;
}): ScriptQuoteSelectionStage {
  const sorted = [...args.quoteEvidence].sort((left, right) => {
    const typeScore =
      (right.sourceType === "clip_transcript" ? 40 : 0) -
      (left.sourceType === "clip_transcript" ? 40 : 0);
    return typeScore + right.relevanceScore - left.relevanceScore;
  });

  const selectedQuotes = sorted.slice(0, 8).map((quote, index) => ({
    ...quote,
    quoteId: `Q${index + 1}`,
    usePriority: index < 4 ? ("must_use" as const) : ("strong_optional" as const),
    usageRole:
      quote.sourceType === "clip_transcript"
        ? "Direct clip receipt that should appear on screen or drive narration."
        : "Article-backed receipt that sharpens the argument when clip evidence is thin.",
    sectionHint: inferSectionHintFromQuote({
      quote,
      sectionHeadings: args.outlineStage.sections.map((section) => section.heading),
      title: args.title,
    }),
    qualityNotes:
      quote.sourceType === "clip_transcript"
        ? "Transcript-backed fallback selection"
        : "Research-text fallback selection",
  }));

  return {
    selectedQuotes,
    rejectedQuotes: [],
  };
}

function buildFallbackQuotePlacementStage(args: {
  outlineStage: ScriptOutlineStage;
  quoteSelectionStage: ScriptQuoteSelectionStage;
}): ScriptQuotePlacementStage {
  return {
    placements: args.outlineStage.sections.map((section) => {
      const sectionQuotes = args.quoteSelectionStage.selectedQuotes.filter(
        (quote) => quote.sectionHint === section.heading
      );
      return {
        sectionHeading: section.heading,
        placementGoal: section.beatGoal,
        requiredQuoteIds: sectionQuotes.slice(0, 1).map((quote) => quote.quoteId),
        optionalQuoteIds: sectionQuotes.slice(1, 3).map((quote) => quote.quoteId),
      };
    }),
  };
}

function buildFallbackSectionPlanStage(args: {
  outlineStage: ScriptOutlineStage;
}): ScriptSectionPlanStage {
  return {
    sections: args.outlineStage.sections.map((section, index, all) => ({
      sectionHeading: section.heading,
      narrativeRole: section.purpose,
      targetWordCount: section.targetWordCount,
      requiredEvidence: section.evidenceSlots,
      openingMove: `Open with the clearest pressure point inside "${section.heading}" and make the audience understand why this beat exists immediately.`,
      closingMove:
        index < all.length - 1
          ? `Close by turning the audience toward "${all[index + 1]?.heading}" and making the escalation feel inevitable.`
          : "Close by tying the evidence back to the modern-day meaning of the story.",
    })),
  };
}

function buildFallbackWhyItMattersStage(args: {
  title: string;
  briefText: string | null;
  deepResearch: DeepResearchCard | null;
  socialPosts: SocialPostCard[];
}): WhyItMattersStage {
  return {
    whyItMattersNow:
      args.deepResearch?.content
        .split(/\n{2,}/)
        .map((item) => item.trim())
        .find((item) => /matters|legacy|now|today|modern/i.test(item) && item.length > 60)
        ?.slice(0, 600) ??
      args.briefText?.split(/\n{2,}/).slice(-1)[0]?.trim() ??
      `${args.title} still matters because the story is really about what happens when someone values truth and instinct more than access, approval, or cultural permission.`,
    modernDayRelevance: dedupeBy(
      [
        "The story speaks to a media culture that still softens its language around powerful people until it becomes safe to say the obvious thing.",
        "It reframes legacy as something earned by absorbing the consequences early, not by winning approval in the moment.",
        "It gives the audience a modern example of why comic honesty can age better than polished cultural consensus.",
      ],
      (item) => item
    ).slice(0, 3),
    tweetWatchlist: dedupeBy(
      args.socialPosts.map((post) => `${post.title} (${post.url})`),
      (item) => item
    ).slice(0, 4),
  };
}

function buildHtml(args: {
  title: string;
  generatedAt: string;
  briefText: string | null;
  deepResearch: DeepResearchCard | null;
  articleQueries: string[];
  mediaQueries: string[];
  socialQueries: string[];
  articleCards: ArticleCard[];
  socialPosts: SocialPostCard[];
  discoveredClips: DiscoveredClipCard[];
  transcriptSources: TranscriptSourceCard[];
  transcriptQuotes: TranscriptQuoteCard[];
  researchStage: Awaited<ReturnType<typeof generateResearchStage>>;
  outlineStage: Awaited<ReturnType<typeof generateOutlineStage>>;
  quoteSelectionStage: ScriptQuoteSelectionStage;
  quotePlacementStage: ScriptQuotePlacementStage;
  sectionPlanStage: ScriptSectionPlanStage;
  whyItMattersStage: WhyItMattersStage;
  sectionClipPackages: SectionClipPackage[];
}) {
  const renderArticleCard = (article: ArticleCard) => {
      const factExtract = article.factExtract;
      return `
        <article class="card">
          <div class="meta">${escapeHtml(article.role.replace(/_/g, " "))} · ${escapeHtml(article.source)}${article.publishedAt ? ` · ${escapeHtml(article.publishedAt)}` : ""}</div>
          <h3>${escapeHtml(article.title)}</h3>
          <p>${escapeHtml(article.snippet || "")}</p>
          <p><a href="${escapeHtml(article.url)}" target="_blank" rel="noreferrer">Open source</a></p>
          <p class="small">extracted chars=${article.contentLength}${article.extractedSiteName ? ` · ${escapeHtml(article.extractedSiteName)}` : ""}</p>
          ${
            factExtract
              ? `
                <div class="block"><strong>Key facts</strong><ul>${factExtract.keyFacts
                  .map((fact) => `<li>${escapeHtml(fact)}</li>`)
                  .join("")}</ul></div>
                ${
                  factExtract.exactQuotes.length > 0
                    ? `<div class="block"><strong>Exact quotes</strong><ul>${factExtract.exactQuotes
                        .map((quote) => `<li>${escapeHtml(quote)}</li>`)
                        .join("")}</ul></div>`
                    : ""
                }
                ${
                  factExtract.operationalDetails.length > 0
                    ? `<div class="block"><strong>Operational details</strong><ul>${factExtract.operationalDetails
                        .map((detail) => `<li>${escapeHtml(detail)}</li>`)
                        .join("")}</ul></div>`
                    : ""
                }
              `
              : article.error
                ? `<p class="error">fact extraction failed: ${escapeHtml(article.error)}</p>`
                : `<p class="small">No structured fact extract saved.</p>`
          }
        </article>
      `;
    };

  const roleLabels: Record<ArticleCard["role"], string> = {
    core_receipts: "Core Receipts",
    system: "System / Business",
    legal: "Legal / Enforcement",
    background: "Background",
  };

  const articleCardsHtml = (["core_receipts", "system", "legal", "background"] as const)
    .map((role) => {
      const cards = args.articleCards.filter((article) => article.role === role);
      if (cards.length === 0) {
        return "";
      }

      return `
        <div class="block">
          <h3>${escapeHtml(roleLabels[role])}</h3>
          <div class="cards">${cards.map((article) => renderArticleCard(article)).join("")}</div>
        </div>
      `;
    })
    .join("");

  const transcriptSourcesHtml = args.transcriptSources
    .map(
      (source) => `
        <article class="card">
          <div class="meta">${escapeHtml(source.provider)} · transcript=${escapeHtml(source.transcriptStatus)}</div>
          <h3>${escapeHtml(source.title)}</h3>
          <p class="small">segments=${source.transcriptSegments}</p>
          <p><a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noreferrer">Open source</a></p>
          ${source.transcriptError ? `<p class="error">${escapeHtml(source.transcriptError)}</p>` : ""}
        </article>
      `
    )
    .join("");

  const transcriptQuotesHtml =
    args.transcriptQuotes.length > 0
      ? args.transcriptQuotes
          .map(
            (quote) => `
              <article class="card">
                <div class="meta">${escapeHtml(quote.sourceLabel)}${quote.startMs != null ? ` · ${escapeHtml(formatTimestamp(quote.startMs))}` : ""} · ${Math.round(quote.relevanceScore)}%</div>
                <p>${escapeHtml(quote.quoteText)}</p>
                ${quote.context ? `<p class="small">${escapeHtml(quote.context)}</p>` : ""}
                <p><a href="${escapeHtml(quote.sourceUrl)}" target="_blank" rel="noreferrer">Open source</a></p>
              </article>
            `
          )
          .join("")
      : `<p class="card">No transcript-backed quotes were captured. If this stays empty on topics with obvious video coverage, the next likely blocker is media access on this host.</p>`;

  const discoveredClipsHtml =
    args.discoveredClips.length > 0
      ? args.discoveredClips
          .map(
            (clip) => `
              <article class="card">
                <div class="meta">${escapeHtml(clip.provider)} · ${Math.round(clip.relevanceScore)}%</div>
                <h3>${escapeHtml(clip.title)}</h3>
                ${clip.channelOrContributor ? `<p class="small">${escapeHtml(clip.channelOrContributor)}</p>` : ""}
                <p><a href="${escapeHtml(clip.sourceUrl)}" target="_blank" rel="noreferrer">Open source</a></p>
              </article>
            `
          )
          .join("")
      : `<p class="card">No video or media clips were discovered.</p>`;

  const outlineHtml = args.outlineStage.sections
    .map(
      (section, index) => `
        <article class="card">
          <div class="meta">Section ${index + 1}</div>
          <h3>${escapeHtml(section.heading)}</h3>
          <p><strong>Purpose:</strong> ${escapeHtml(section.purpose)}</p>
          <p><strong>Beat goal:</strong> ${escapeHtml(section.beatGoal)}</p>
        </article>
      `
    )
    .join("");

  const socialPostsHtml =
    args.socialPosts.length > 0
      ? args.socialPosts
          .map(
            (post) => `
              <article class="card">
                <div class="meta">${post.publishedAt ? `${escapeHtml(post.publishedAt)} · ` : ""}${Math.round(post.relevanceScore)}%</div>
                <h3>${escapeHtml(post.title)}</h3>
                <p>${escapeHtml(post.snippet || "")}</p>
                <p><a href="${escapeHtml(post.url)}" target="_blank" rel="noreferrer">Open post</a></p>
              </article>
            `
          )
          .join("")
      : `<p class="card">No direct tweet/X post leads were surfaced in this pass.</p>`;

  const selectedQuotesHtml =
    args.quoteSelectionStage.selectedQuotes.length > 0
      ? args.quoteSelectionStage.selectedQuotes
          .map(
            (quote) => `
              <article class="card">
                <div class="meta">${escapeHtml(quote.quoteId)} · ${escapeHtml(quote.usePriority)} · ${Math.round(
                  quote.relevanceScore
                )}%</div>
                <h3>${escapeHtml(quote.sourceTitle)}</h3>
                <p>${escapeHtml(quote.quoteText)}</p>
                <p class="small">${escapeHtml(quote.usageRole)}</p>
                ${quote.sectionHint ? `<p class="small">section hint: ${escapeHtml(quote.sectionHint)}</p>` : ""}
                ${quote.sourceUrl ? `<p><a href="${escapeHtml(quote.sourceUrl)}" target="_blank" rel="noreferrer">Open source</a></p>` : ""}
              </article>
            `
          )
          .join("")
      : `<p class="card">No quotes were selected for section use.</p>`;

  const deepResearchHtml = args.deepResearch
    ? `<section class="section">
            <h2>Parallel Deep Research Memo</h2>
            <p class="small">processor=${escapeHtml(args.deepResearch.processor)} · runId=${escapeHtml(
              args.deepResearch.runId
            )}${args.deepResearch.basisCount != null ? ` · basis=${args.deepResearch.basisCount}` : ""}</p>
            <pre>${escapeHtml(trimToLength(args.deepResearch.content, 12000))}</pre>
          </section>`
    : "";

  const sectionClipPackagesHtml = args.sectionClipPackages
    .map(
      (section) => `
        <article class="card">
          <div class="meta">${escapeHtml(section.sectionHeading)}</div>
          <p><strong>Narrative role:</strong> ${escapeHtml(section.narrativeRole)}</p>
          <p><strong>Why it matters now:</strong> ${escapeHtml(section.whyItMattersNow)}</p>
          <p><strong>Opening move:</strong> ${escapeHtml(section.openingMove)}</p>
          <p><strong>Closing move:</strong> ${escapeHtml(section.closingMove)}</p>
          ${
            section.queryPlan
              ? `<div class="block"><strong>Section query plan</strong>
                  <p class="small"><strong>Article:</strong> ${escapeHtml(section.queryPlan.articleQueries.join(" | "))}</p>
                  <p class="small"><strong>Media:</strong> ${escapeHtml(section.queryPlan.mediaQueries.join(" | "))}</p>
                  <p class="small"><strong>Social:</strong> ${escapeHtml(section.queryPlan.socialQueries.join(" | "))}</p>
                </div>`
              : ""
          }
          ${
            section.linkedEvidenceSlots.length > 0
              ? `<div class="block"><strong>Evidence slots</strong><ul>${section.linkedEvidenceSlots
                  .map(
                    (slot) =>
                      `<li><strong>${escapeHtml(slot.label)}</strong>: ${
                        slot.sourceUrl
                          ? `<a href="${escapeHtml(slot.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(
                              slot.sourceTitle ?? slot.sourceType
                            )}</a>`
                          : escapeHtml(slot.sourceTitle ?? "Unlinked")
                      }${
                        slot.startMs != null ? ` (${escapeHtml(formatTimestamp(slot.startMs))})` : ""
                      }${slot.note ? ` · ${escapeHtml(slot.note)}` : ""}</li>`
                  )
                  .join("")}</ul></div>`
              : ""
          }
          ${
            section.keyClipsToWatch.length > 0
              ? `<div class="block"><strong>Key clips to watch</strong><ul>${section.keyClipsToWatch
                  .map(
                    (clip) =>
                      `<li><a href="${escapeHtml(clip.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(
                        clip.title
                      )}</a>${clip.channelOrContributor ? ` · ${escapeHtml(clip.channelOrContributor)}` : ""}</li>`
                  )
                  .join("")}</ul></div>`
              : ""
          }
          ${
            section.relatedArticles.length > 0
              ? `<div class="block"><strong>Related articles</strong><ul>${section.relatedArticles
                  .map(
                    (article) =>
                      `<li><a href="${escapeHtml(article.url)}" target="_blank" rel="noreferrer">${escapeHtml(
                        article.title
                      )}</a>${article.keyPoints.length > 0 ? ` · ${escapeHtml(article.keyPoints.join(" | "))}` : ""}</li>`
                  )
                  .join("")}</ul></div>`
              : ""
          }
          ${
            section.relatedSocialPosts.length > 0
              ? `<div class="block"><strong>Related socials</strong><ul>${section.relatedSocialPosts
                  .map(
                    (post) =>
                      `<li><a href="${escapeHtml(post.url)}" target="_blank" rel="noreferrer">${escapeHtml(
                        post.title
                      )}</a>${post.snippet ? ` · ${escapeHtml(trimToLength(post.snippet, 160))}` : ""}</li>`
                  )
                  .join("")}</ul></div>`
              : ""
          }
          ${
            section.exactQuotes.length > 0
              ? `<div class="block"><strong>Exact quotes to use</strong><ul>${section.exactQuotes
                  .map(
                    (quote) =>
                      `<li><strong>${escapeHtml(quote.sourceTitle)}</strong>: ${escapeHtml(
                        quote.quoteText
                      )}${quote.startMs != null ? ` (${escapeHtml(formatTimestamp(quote.startMs))})` : ""}</li>`
                  )
                  .join("")}</ul></div>`
              : `<p class="small">No clip quote assigned to this section yet.</p>`
          }
          ${
            section.transcriptQuotes.length > 0
              ? `<div class="block"><strong>Transcript passages</strong><ul>${section.transcriptQuotes
                  .map(
                    (quote) =>
                      `<li><a href="${escapeHtml(quote.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(
                        quote.sourceLabel
                      )}</a>${quote.startMs != null ? ` (${escapeHtml(formatTimestamp(quote.startMs))})` : ""}: ${escapeHtml(
                        trimToLength(quote.quoteText, 220)
                      )}</li>`
                  )
                  .join("")}</ul></div>`
              : ""
          }
        </article>
      `
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(args.title)} Research Review</title>
    <style>
      body { margin: 0; font-family: Georgia, "Times New Roman", serif; background: linear-gradient(180deg, #f6f2ea 0%, #e8dfcf 100%); color: #1d1c18; }
      main { max-width: 1240px; margin: 0 auto; padding: 40px 20px 80px; }
      h1 { font-size: clamp(2rem, 4vw, 4rem); line-height: 0.96; margin: 12px 0; }
      h2 { font-size: 1.6rem; margin: 0 0 14px; }
      h3 { font-size: 1.05rem; margin: 0 0 10px; }
      p, li { line-height: 1.55; }
      a { color: #6e240d; }
      .eyebrow { text-transform: uppercase; letter-spacing: 0.16em; font-size: 12px; color: #7f6f5b; }
      .lede { max-width: 880px; font-size: 17px; color: #4a4136; }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 28px; }
      .chip { background: rgba(29, 28, 24, 0.08); border-radius: 999px; padding: 8px 12px; font-size: 13px; }
      .grid { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 20px; }
      .stack { display: grid; gap: 20px; }
      .section { background: rgba(255,255,255,0.78); border: 1px solid rgba(29,28,24,0.12); border-radius: 22px; padding: 22px; box-shadow: 0 16px 40px rgba(40, 31, 18, 0.08); }
      .cards { display: grid; gap: 12px; }
      .card { background: rgba(29, 28, 24, 0.04); border-radius: 16px; padding: 14px; }
      .meta { font-size: 12px; color: #786b5c; margin-bottom: 6px; }
      .small { font-size: 13px; color: #5c5348; }
      .error { color: #8b1e17; font-size: 13px; }
      ul { margin: 8px 0 0; padding-left: 20px; }
      .block { margin-top: 12px; }
      pre { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; line-height: 1.5; }
      @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Moon Internal</div>
      <h1>${escapeHtml(args.title)} Research Review</h1>
      <p class="lede">Direct research build using search, article extraction, local media transcription attempts, transcript quote mining, and Claude research/outline synthesis. Generated ${escapeHtml(args.generatedAt)}.</p>
      <div class="chips">
        ${args.deepResearch ? `<div class="chip">Deep research: ${escapeHtml(args.deepResearch.processor)}</div>` : ""}
        <div class="chip">Article queries: ${args.articleQueries.length}</div>
        <div class="chip">Media queries: ${args.mediaQueries.length}</div>
        <div class="chip">Social posts: ${args.socialPosts.length}</div>
        <div class="chip">Articles extracted: ${args.articleCards.length}</div>
        <div class="chip">Discovered clips: ${args.discoveredClips.length}</div>
        <div class="chip">Transcript sources: ${args.transcriptSources.length}</div>
        <div class="chip">Transcript quotes: ${args.transcriptQuotes.length}</div>
        <div class="chip">Selected quotes: ${args.quoteSelectionStage.selectedQuotes.length}</div>
        <div class="chip">Outline sections: ${args.outlineStage.sections.length}</div>
      </div>
      <div class="grid">
        <div class="stack">
          ${
            args.briefText
              ? `<section class="section">
            <h2>Editorial Brief</h2>
            <p>${escapeHtml(args.briefText)}</p>
          </section>`
              : ""
          }
          ${deepResearchHtml}
          <section class="section">
            <h2>Research Queries</h2>
            <p><strong>Article:</strong> ${escapeHtml(args.articleQueries.join(" | "))}</p>
            <p><strong>Media:</strong> ${escapeHtml(args.mediaQueries.join(" | "))}</p>
            <p><strong>Social:</strong> ${escapeHtml(args.socialQueries.join(" | "))}</p>
          </section>
          <section class="section">
            <h2>Claude Research Summary</h2>
            <p><strong>Summary:</strong> ${escapeHtml(args.researchStage.summary)}</p>
            <p><strong>Thesis:</strong> ${escapeHtml(args.researchStage.thesis)}</p>
            <div class="block"><strong>Key claims</strong><ul>${args.researchStage.keyClaims.map((claim) => `<li>${escapeHtml(claim)}</li>`).join("")}</ul></div>
            <div class="block"><strong>Risky claims</strong><ul>${args.researchStage.riskyClaims.map((claim) => `<li>${escapeHtml(claim)}</li>`).join("")}</ul></div>
            <div class="block"><strong>Why it matters now</strong><p>${escapeHtml(args.whyItMattersStage.whyItMattersNow)}</p></div>
            <div class="block"><strong>Modern relevance</strong><ul>${args.whyItMattersStage.modernDayRelevance
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join("")}</ul></div>
          </section>
          <section class="section">
            <h2>Claude Outline</h2>
            <div class="cards">${outlineHtml}</div>
          </section>
          <section class="section">
            <h2>Section Quote And Clip Plan</h2>
            <div class="cards">${sectionClipPackagesHtml}</div>
          </section>
          <section class="section">
            <h2>Article Research</h2>
            <div class="cards">${articleCardsHtml}</div>
          </section>
        </div>
        <div class="stack">
          <section class="section">
            <h2>Most Interesting Clips To Watch</h2>
            <div class="cards">${discoveredClipsHtml}</div>
          </section>
          <section class="section">
            <h2>Tweet / Social Leads</h2>
            <div class="cards">${socialPostsHtml}</div>
          </section>
          <section class="section">
            <h2>Transcript Quotes</h2>
            <div class="cards">${transcriptQuotesHtml}</div>
          </section>
          <section class="section">
            <h2>Selected Quotes For Section Use</h2>
            <div class="cards">${selectedQuotesHtml}</div>
          </section>
          <section class="section">
            <h2>Transcript Source Status</h2>
            <div class="cards">${transcriptSourcesHtml}</div>
          </section>
          <section class="section">
            <h2>Claude Seed Quote Evidence</h2>
            <pre>${escapeHtml(
              JSON.stringify(
                args.researchStage.quoteEvidence.map((quote) => ({
                  sourceTitle: quote.sourceTitle,
                  sourceUrl: quote.sourceUrl,
                  quoteText: quote.quoteText,
                  speaker: quote.speaker,
                  relevanceScore: quote.relevanceScore,
                  startMs: quote.startMs ?? null,
                })),
                null,
                2
              )
            )}</pre>
          </section>
        </div>
      </div>
    </main>
  </body>
</html>`;
}

async function main() {
  const slugArg = process.argv[2]?.trim();
  const titleArg = process.argv[3]?.trim();
  const briefPathArg = process.argv[4]?.trim();

  if (!slugArg || !titleArg) {
    throw new Error("Usage: build-direct-research-outline-report.ts <slug> <story title> [brief-path]");
  }

  const slug = slugify(slugArg);
  const title = titleArg;
  const briefText = briefPathArg ? (await readFile(briefPathArg, "utf8")).trim() : null;
  const generatedAt = new Date().toISOString();
  const reusedDeepResearch =
    process.env.REUSE_EXISTING_DEEP_RESEARCH === "1"
      ? await loadExistingDeepResearch(slug)
      : null;
  const deepResearch =
    reusedDeepResearch
    ?? (await runDeepResearchMemo({
      query: title,
      briefText,
      timeoutSeconds: 120,
    }).catch(() => null));
  if (reusedDeepResearch) {
    console.log("[direct-report] reusing existing parallel deep research memo");
  }
  if (deepResearch) {
    console.log(
      `[direct-report] parallel deep research complete: ${deepResearch.processor} / ${deepResearch.runId}`
    );
  }

  const storyKeywords = tokenizeKeywords(
    [title, briefText ?? "", deepResearch?.content ?? ""].join(" "),
    12
  );
  const profileTopic = isProfileTopic(title, briefText);
  let queryPlanStage: QueryPlanStage;
  try {
    queryPlanStage = await generateQueryPlanStage({
      title,
      briefText,
      deepResearch,
      profileTopic,
    });
    console.log("[direct-report] sonnet query plan stage complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[direct-report] sonnet query plan stage failed, using fallback: ${message}`);
    queryPlanStage = buildFallbackQueryPlan({
      title,
      briefText,
      deepResearch,
      profileTopic,
    });
  }
  const articleQueries = dedupeBy(queryPlanStage.articleQueries, (item) => item);
  const mediaQueries = dedupeBy(queryPlanStage.mediaQueries, (item) => item);
  const socialQueries = dedupeBy(queryPlanStage.socialQueries, (item) => item);

  console.log(`[direct-report] starting: ${title}`);
  console.log(`[direct-report] article queries: ${articleQueries.join(" | ")}`);
  console.log(`[direct-report] media queries: ${mediaQueries.join(" | ")}`);
  console.log(`[direct-report] social queries: ${socialQueries.join(" | ")}`);

  const newsResults = dedupeBy(
    (
      await Promise.all(articleQueries.map((query) => searchNewsStory(query, "full").catch(() => [])))
    ).flat(),
    (item) => item.url
  )
    .sort(
      (left, right) =>
        scoreNewsResultForReport(right, storyKeywords) -
        scoreNewsResultForReport(left, storyKeywords)
    )
    .filter((result, index, array) => {
      const host = getNormalizedHostname(result.url);
      return array.slice(0, index).filter((item) => getNormalizedHostname(item.url) === host).length < 2;
    })
    .slice(0, 6);

  console.log(`[direct-report] news results selected: ${newsResults.length}`);

  const articleCards: ArticleCard[] = [];
  for (const result of newsResults) {
    console.log(`[direct-report] extracting article: ${result.title}`);
    const extracted = await extractContent(result.url);
    if (extracted.content.trim().length < 600) {
      const role = classifyArticleRole({
        title: result.title,
        url: result.url,
        source: result.source,
        role: "background",
        snippet: result.snippet,
        publishedAt: result.publishedAt,
        contentLength: extracted.content.length,
        extractedTitle: extracted.title,
        extractedSiteName: extracted.siteName,
        factExtract: null,
        error: "content extraction too thin",
      });
      articleCards.push({
        title: result.title,
        url: result.url,
        source: result.source,
        role,
        snippet: result.snippet,
        publishedAt: result.publishedAt,
        contentLength: extracted.content.length,
        extractedTitle: extracted.title,
        extractedSiteName: extracted.siteName,
        factExtract: null,
        error: "content extraction too thin",
      });
      continue;
    }

    try {
      const factExtract = await extractArticleFactsFromMarkdown({
        sourceUrl: result.url,
        title: extracted.title ?? result.title,
        siteName: extracted.siteName,
        markdown: extracted.content,
      });
      const role = classifyArticleRole({
        title: result.title,
        url: result.url,
        source: result.source,
        role: "background",
        snippet: result.snippet,
        publishedAt: result.publishedAt,
        contentLength: extracted.content.length,
        extractedTitle: extracted.title,
        extractedSiteName: extracted.siteName,
        factExtract: factExtract.facts,
        error: null,
      });

      articleCards.push({
        title: result.title,
        url: result.url,
        source: result.source,
        role,
        snippet: result.snippet,
        publishedAt: result.publishedAt,
        contentLength: extracted.content.length,
        extractedTitle: extracted.title,
        extractedSiteName: extracted.siteName,
        factExtract: factExtract.facts,
        error: null,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const role = classifyArticleRole({
        title: result.title,
        url: result.url,
        source: result.source,
        role: "background",
        snippet: result.snippet,
        publishedAt: result.publishedAt,
        contentLength: extracted.content.length,
        extractedTitle: extracted.title,
        extractedSiteName: extracted.siteName,
        factExtract: null,
        error: errorMessage,
      });
      articleCards.push({
        title: result.title,
        url: result.url,
        source: result.source,
        role,
        snippet: result.snippet,
        publishedAt: result.publishedAt,
        contentLength: extracted.content.length,
        extractedTitle: extracted.title,
        extractedSiteName: extracted.siteName,
        factExtract: null,
        error: errorMessage,
      });
    }
  }

  console.log(`[direct-report] structured article cards: ${articleCards.length}`);

  const socialPosts = await discoverSocialPosts({
    title,
    briefText,
    articleCards,
    deepResearch,
    socialQueries,
  });
  console.log(`[direct-report] social posts discovered: ${socialPosts.length}`);

  const expandedMediaQueries = dedupeBy(
    [
      ...mediaQueries,
      ...(briefText ? [] : buildQuoteDrivenMediaQueries(title, articleCards, storyKeywords)),
    ],
    (item) => item
  ).slice(0, 16);
  console.log(`[direct-report] expanded media queries: ${expandedMediaQueries.join(" | ")}`);

  const topicResults = await Promise.all(
    expandedMediaQueries.map((query) =>
      withTimeout(
        searchTopic(query, {
          includeLocalTranscriptFallback: true,
          includeAiQuotes: false,
        }),
        45_000,
        () => ({
          query,
          searchId: "",
          clips: [],
          quotes: [],
          totalFound: 0,
          totalFiltered: 0,
        })
      ).catch(() => ({
        query,
        searchId: "",
        clips: [],
        quotes: [],
        totalFound: 0,
        totalFiltered: 0,
      }))
    )
  );

  const rankedMediaClips = dedupeBy(
    topicResults
      .flatMap((result) => result.clips)
      .filter(
        (clip) =>
          !shouldExcludeCommentaryCandidate({
            provider: clip.provider,
            title: clip.title,
            sourceUrl: clip.sourceUrl,
            channelOrContributor: clip.channelOrContributor,
          })
      )
      .sort(
        (left, right) =>
          scoreMediaClipForReport(right, storyKeywords) -
          scoreMediaClipForReport(left, storyKeywords)
      ),
    (clip) => clip.sourceUrl
  )
    .filter((clip) => scoreMediaClipForReport(clip, storyKeywords) >= 55);
  const mediaClips = rankedMediaClips.slice(0, profileTopic ? 18 : 16);
  const discoveredClips: DiscoveredClipCard[] = mediaClips.map((clip) => ({
    title: clip.title,
    provider: clip.provider,
    sourceUrl: clip.sourceUrl,
    channelOrContributor: clip.channelOrContributor,
    relevanceScore: clip.relevanceScore,
  }));
  const youtubeTranscriptTargets = rankedMediaClips.filter((clip) => clip.provider === "youtube");
  const quoteExtractionTargets = youtubeTranscriptTargets.slice(0, profileTopic ? 12 : 14);

  const searchTopicQuotes: TranscriptQuoteCard[] = [];
  const quotePrompts = buildDocumentaryQuotePrompts(title, articleCards, briefText);
  const needlePhrases = buildTranscriptNeedlePhrases(articleCards, storyKeywords, briefText);
  const recoveredTranscriptSegments = new Map<string, number>();

  for (const clip of youtubeTranscriptTargets) {
    const segments = await withTimeout(
      ensureYouTubeTranscript(clip.clipId, clip.externalId),
      20_000,
      () => []
    );
    if (!segments || segments.length === 0) {
      continue;
    }
    recoveredTranscriptSegments.set(clip.sourceUrl, segments.length);

    if (!quoteExtractionTargets.some((target) => target.sourceUrl === clip.sourceUrl)) {
      continue;
    }

    const quotes = await collectTranscriptQuotesForClip({
      clip,
      segments,
      quotePrompts,
      needlePhrases,
      storyKeywords,
    });
    searchTopicQuotes.push(...quotes);
  }

  const filteredTopicQuotes = dedupeBy(
    searchTopicQuotes.sort((left, right) => right.relevanceScore - left.relevanceScore),
    (quote) => `${quote.sourceUrl}|${quote.startMs}|${quote.quoteText}`
  ).slice(0, 12);

  console.log(
    `[direct-report] media clips selected: ${mediaClips.length}, youtube transcript targets: ${youtubeTranscriptTargets.length}, quote extraction targets: ${quoteExtractionTargets.length}, clean topic quotes: ${filteredTopicQuotes.length}`
  );

  const transcriptSources: TranscriptSourceCard[] = [];
  const transcriptQuotes: TranscriptQuoteCard[] = [...filteredTopicQuotes];
  const clipsNeedingLocalIngest = quoteExtractionTargets;

  for (const clip of clipsNeedingLocalIngest) {
    const existingClipQuotes = transcriptQuotes.filter((quote) =>
      quote.sourceUrl.includes(clip.externalId)
    );
    const recoveredSegments = recoveredTranscriptSegments.get(clip.sourceUrl) ?? 0;
    if (existingClipQuotes.length > 0) {
      transcriptSources.push({
        title: clip.title,
        provider: clip.provider,
        sourceUrl: clip.sourceUrl,
        transcriptStatus: "complete",
        transcriptSegments: recoveredSegments,
        transcriptError: null,
      });
      continue;
    }
    if (recoveredSegments > 0) {
      transcriptSources.push({
        title: clip.title,
        provider: clip.provider,
        sourceUrl: clip.sourceUrl,
        transcriptStatus: "complete",
        transcriptSegments: recoveredSegments,
        transcriptError: "Transcript recovered, but no quote survived filtering",
      });
      continue;
    }
    console.log(`[direct-report] ingesting media: ${clip.title}`);
    try {
      const localMedia = await withTimeout(
        ingestLocalMediaArtifacts({
          sourceUrl: clip.sourceUrl,
          providerName: clip.provider,
          title: clip.title,
        }),
        60_000,
        () => null
      );

      if (!localMedia || localMedia.transcript.length === 0) {
        transcriptSources.push({
          title: clip.title,
          provider: clip.provider,
          sourceUrl: clip.sourceUrl,
          transcriptStatus: "failed",
          transcriptSegments: 0,
          transcriptError: "No transcript recovered on this host",
        });
        continue;
      }

      const quotes = await collectTranscriptQuotesForClip({
        clip: {
          title: localMedia.title,
          sourceUrl: clip.sourceUrl,
          provider: clip.provider,
        },
        segments: localMedia.transcript,
        quotePrompts,
        needlePhrases,
        storyKeywords,
      });

      transcriptSources.push({
        title: localMedia.title,
        provider: clip.provider,
        sourceUrl: clip.sourceUrl,
        transcriptStatus: quotes.length > 0 ? "complete" : "failed",
        transcriptSegments: localMedia.transcript.length,
        transcriptError: quotes.length > 0 ? null : "No usable transcript quote survived filtering",
      });

      for (const quote of quotes) {
        transcriptQuotes.push({
          sourceLabel: localMedia.title,
          sourceUrl:
            clip.provider === "youtube" && typeof quote.startMs === "number"
              ? `${clip.sourceUrl}${clip.sourceUrl.includes("?") ? "&" : "?"}t=${Math.floor(
                  quote.startMs / 1000
                )}`
              : clip.sourceUrl,
          quoteText: quote.quoteText,
          speaker: quote.speaker,
          context: quote.context,
          startMs: quote.startMs,
          endMs: quote.endMs,
          relevanceScore: quote.relevanceScore,
        });
      }
      console.log(
        `[direct-report] transcript complete: ${localMedia.title} (${localMedia.transcript.length} segments, ${quotes.length} quotes)`
      );
    } catch (error) {
      console.log(`[direct-report] transcript failed: ${clip.title}`);
      transcriptSources.push({
        title: clip.title,
        provider: clip.provider,
        sourceUrl: clip.sourceUrl,
        transcriptStatus: "failed",
        transcriptSegments: 0,
        transcriptError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const finalTranscriptQuotes = dedupeBy(
    transcriptQuotes.sort((left, right) => right.relevanceScore - left.relevanceScore),
    (quote) => `${quote.sourceUrl}|${quote.startMs}|${quote.quoteText}`
  ).slice(0, 20);

  const seedQuoteEvidence: ScriptEvidenceQuote[] = [
    ...finalTranscriptQuotes.map((quote) => ({
      sourceType: "clip_transcript" as const,
      sourceTitle: quote.sourceLabel,
      sourceUrl: quote.sourceUrl,
      quoteText: quote.quoteText,
      speaker: quote.speaker,
      context:
        quote.context ?? `Transcript-backed quote from ${quote.sourceLabel}`,
      relevanceScore: Math.max(0, Math.min(100, Math.round(quote.relevanceScore))),
      startMs: quote.startMs ?? undefined,
      endMs: quote.endMs ?? undefined,
    })),
    ...articleCards.flatMap((article) =>
      (article.factExtract?.exactQuotes ?? []).slice(0, 2).map((quote) => ({
        sourceType: "research_text" as const,
        sourceTitle: article.title,
        sourceUrl: article.url,
        quoteText: quote,
        speaker: null,
        context: `Article quote from ${article.title}`,
        relevanceScore: 72,
      }))
    ),
  ].slice(0, 20);

  const researchText = buildResearchText({
    title,
    briefText,
    deepResearch,
    articleQueries,
    mediaQueries: expandedMediaQueries,
    articleCards,
    socialPosts,
    discoveredClips,
    transcriptQuotes: finalTranscriptQuotes,
  });

  const input = scriptLabRequestSchema.parse({
    storyTitle: title,
    researchText,
    notes: [
      "Direct research build from search, extracted articles, and transcript quote mining.",
      "Transcript-backed video evidence is the highest-value evidence and should anchor the story whenever usable.",
      "Prefer Moon documentary structure, specific receipts, and concrete turns.",
      briefText ? `Editorial brief:\n${briefText}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
    targetRuntimeMinutes: 12,
  });

  const context = await prepareScriptLabPipelineContext(input);
  console.log("[direct-report] Moon context prepared");
  const stageFallbackReasons: string[] = [];
  let stageResearchPacket = context.researchPacket;
  let researchStage: ScriptResearchStage;
  try {
    researchStage = await generateResearchStage({
      input: context.input,
      moonAnalysis: context.moonAnalysis,
      researchPacket: stageResearchPacket,
      seedQuoteEvidence,
    });
    console.log("[direct-report] research stage complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stageFallbackReasons.push(`researchStage: ${message}`);
    console.warn(`[direct-report] research stage failed, using fallback: ${message}`);
    researchStage = buildFallbackResearchStage({
      title,
      briefText,
      deepResearch,
      articleCards,
      seedQuoteEvidence,
    });
  }

  let outlineStageDraft: ScriptOutlineStage;
  try {
    outlineStageDraft = await generateOutlineStage({
      researchPacket: stageResearchPacket,
      researchStage,
      targetWordRange: context.targetWordRange,
    });
    console.log("[direct-report] draft outline stage complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stageFallbackReasons.push(`outlineStage: ${message}`);
    console.warn(`[direct-report] outline stage failed, using fallback: ${message}`);
    outlineStageDraft = buildFallbackOutlineStage({
      title,
      briefText,
    });
  }

  let sectionQueryPlans: SectionQueryPlan[];
  try {
    const sectionQueryStage = await generateSectionQueryPlanStage({
      title,
      briefText,
      deepResearch,
      outlineStage: outlineStageDraft,
      globalQueryPlan: {
        articleQueries,
        mediaQueries: expandedMediaQueries,
        socialQueries,
      },
    });
    sectionQueryPlans = outlineStageDraft.sections.map((section) => {
      const match =
        sectionQueryStage.sections.find((item) => item.sectionHeading === section.heading)
        ?? sectionQueryStage.sections.find(
          (item) => item.sectionHeading.toLowerCase() === section.heading.toLowerCase()
        );
      return (
        match ?? {
          sectionHeading: section.heading,
          articleQueries: [],
          mediaQueries: [],
          socialQueries: [],
        }
      );
    });
    console.log("[direct-report] section query plan stage complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stageFallbackReasons.push(`sectionQueryPlanStage: ${message}`);
    console.warn(`[direct-report] section query plan stage failed, using fallback: ${message}`);
    sectionQueryPlans = buildFallbackSectionQueryPlans({
      outlineStage: outlineStageDraft,
      globalQueryPlan: {
        articleQueries,
        mediaQueries: expandedMediaQueries,
        socialQueries,
      },
    });
  }

  let sectionSourceBundles: SectionSourceBundle[] = [];
  try {
    sectionSourceBundles = await discoverSectionSourceBundles({
      title,
      briefText,
      deepResearch,
      outlineStage: outlineStageDraft,
      sectionQueryPlans,
    });
    const sectionResearchAppendix = buildSectionSourceResearchAppendix(sectionSourceBundles);
    if (sectionResearchAppendix) {
      stageResearchPacket = `${context.researchPacket}\n\n${sectionResearchAppendix}`;
    }
    console.log(
      `[direct-report] section source discovery complete: ${sectionSourceBundles.length} bundles`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stageFallbackReasons.push(`sectionSourceDiscovery: ${message}`);
    console.warn(`[direct-report] section source discovery failed: ${message}`);
    stageResearchPacket = context.researchPacket;
    sectionSourceBundles = [];
  }

  let outlineStage: ScriptOutlineStage;
  try {
    outlineStage = await generateFinalOutlineStage({
      researchPacket: stageResearchPacket,
      researchStage,
      targetWordRange: context.targetWordRange,
      draftOutlineStage: outlineStageDraft,
    });
    console.log("[direct-report] final outline stage complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stageFallbackReasons.push(`finalOutlineStage: ${message}`);
    console.warn(`[direct-report] final outline stage failed, using draft outline: ${message}`);
    outlineStage = outlineStageDraft;
  }

  let quoteSelectionStage: ScriptQuoteSelectionStage;
  try {
    quoteSelectionStage = await generateQuoteSelectionStage({
      researchPacket: stageResearchPacket,
      researchStage,
    });
    console.log("[direct-report] quote selection stage complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stageFallbackReasons.push(`quoteSelectionStage: ${message}`);
    console.warn(`[direct-report] quote selection stage failed, using fallback: ${message}`);
    quoteSelectionStage = buildFallbackQuoteSelectionStage({
      title,
      quoteEvidence: researchStage.quoteEvidence,
      outlineStage,
    });
  }

  let quotePlacementStage: ScriptQuotePlacementStage;
  try {
    quotePlacementStage = await generateQuotePlacementStage({
      researchPacket: stageResearchPacket,
      researchStage,
      outlineStage,
      quoteSelectionStage,
    });
    console.log("[direct-report] quote placement stage complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stageFallbackReasons.push(`quotePlacementStage: ${message}`);
    console.warn(`[direct-report] quote placement stage failed, using fallback: ${message}`);
    quotePlacementStage = buildFallbackQuotePlacementStage({
      outlineStage,
      quoteSelectionStage,
    });
  }

  const storyboardStage = generateStoryboardStage({
    outlineStage,
    researchStage,
  });

  let sectionPlanStage: ScriptSectionPlanStage;
  try {
    sectionPlanStage = await generateSectionPlanStage({
      researchPacket: stageResearchPacket,
      researchStage,
      quoteSelectionStage,
      outlineStage,
      quotePlacementStage,
      storyboardStage,
    });
    console.log("[direct-report] section plan stage complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stageFallbackReasons.push(`sectionPlanStage: ${message}`);
    console.warn(`[direct-report] section plan stage failed, using fallback: ${message}`);
    sectionPlanStage = buildFallbackSectionPlanStage({
      outlineStage,
    });
  }

  let whyItMattersStage: WhyItMattersStage;
  try {
    whyItMattersStage = await generateWhyItMattersStage({
      title,
      briefText,
      deepResearch,
      researchStage,
      socialPosts,
    });
    console.log("[direct-report] why-it-matters stage complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stageFallbackReasons.push(`whyItMattersStage: ${message}`);
    console.warn(`[direct-report] why-it-matters stage failed, using fallback: ${message}`);
    whyItMattersStage = buildFallbackWhyItMattersStage({
      title,
      briefText,
      deepResearch,
      socialPosts,
    });
  }

  const stageFallbackReason =
    stageFallbackReasons.length > 0 ? stageFallbackReasons.join(" | ") : null;
  const sectionClipPackages = buildSectionClipPackages({
    outlineStage,
    quoteSelectionStage,
    quotePlacementStage,
    sectionPlanStage,
    sectionQueryPlans,
    sectionSourceBundles,
    discoveredClips,
    articleCards,
    socialPosts,
    transcriptQuotes: finalTranscriptQuotes,
  });

  const report = {
    slug,
    title,
    generatedAt,
    briefText,
    deepResearch,
    articleQueries,
    mediaQueries,
    socialQueries,
    articleCards,
    socialPosts,
    discoveredClips,
    transcriptSources,
    transcriptQuotes: finalTranscriptQuotes,
    researchStage,
    outlineStage,
    quoteSelectionStage,
    quotePlacementStage,
    sectionPlanStage,
    whyItMattersStage,
    sectionClipPackages,
    sectionQueryPlans,
    sectionSourceBundles,
    stageFallbackReason,
  };
  const canonicalResearchPacket = buildCanonicalResearchPacket({
    slug,
    title,
    generatedAt,
    briefText,
    deepResearch,
    articleQueries,
    mediaQueries,
    socialQueries,
    articleCards,
    socialPosts,
    discoveredClips,
    transcriptSources,
    transcriptQuotes: finalTranscriptQuotes,
    researchStage,
    outlineStage,
    quoteSelectionStage,
    quotePlacementStage,
    sectionPlanStage,
    whyItMattersStage,
    sectionClipPackages,
    stageFallbackReason,
  });

  const researchDir = path.resolve(process.cwd(), "research");
  const publicDir = path.resolve(process.cwd(), "public", "research");
  await mkdir(researchDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  const jsonPath = path.join(researchDir, `direct-outline-${slug}.json`);
  const packetJsonPath = path.join(researchDir, `research-packet-${slug}.json`);
  const htmlPath = path.join(publicDir, `${slug}-research-review.html`);
  const publicPacketJsonPath = path.join(publicDir, `${slug}-research-packet.json`);

  const sanitizedReport = sanitizeUrlFields(report);
  const sanitizedCanonicalResearchPacket = sanitizeUrlFields(canonicalResearchPacket);

  await writeFile(jsonPath, `${JSON.stringify(sanitizedReport, null, 2)}\n`, "utf8");
  await writeFile(
    packetJsonPath,
    `${JSON.stringify(sanitizedCanonicalResearchPacket, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    publicPacketJsonPath,
    `${JSON.stringify(sanitizedCanonicalResearchPacket, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    htmlPath,
    buildHtml({
      title,
      generatedAt,
      briefText,
      deepResearch,
      articleQueries,
      mediaQueries,
      socialQueries,
      articleCards,
      socialPosts,
      discoveredClips,
      transcriptSources,
      transcriptQuotes: finalTranscriptQuotes,
      researchStage,
      outlineStage,
      quoteSelectionStage,
      quotePlacementStage,
      sectionPlanStage,
      whyItMattersStage,
      sectionClipPackages,
    }),
    "utf8"
  );

  console.log("[direct-report] report files written");
  console.log(JSON.stringify({ jsonPath, packetJsonPath, publicPacketJsonPath, htmlPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
