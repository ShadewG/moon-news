import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  boardFeedItems,
  boardStoryCandidates,
  boardStorySources,
  clipLibrary,
  moonCorpusClusters,
  moonCorpusTerms,
  moonStoryScores,
  moonVideoProfiles,
  transcriptCache,
} from "@/server/db/schema";

const MOON_CORPUS_PROFILE_VERSION = 1;
const RECENT_WINDOW_DAYS = 90;
const MAX_ANALOGS = 5;
const TOP_TITLE_TERMS = 18;
const TOP_TRANSCRIPT_TERMS = 32;
const TOP_CORPUS_TERMS = 300;
const TOP_CLUSTERS = 24;
const MAX_CORPUS_TERM_DOCUMENT_SHARE = 0.16;
const MAX_CORPUS_TERM_DOCUMENT_COUNT = 55;

const STOPWORDS = new Set([
  "about", "after", "again", "against", "all", "also", "always", "amid", "among", "and",
  "another", "around", "because", "been", "before", "being", "between", "both", "but",
  "came", "come", "could", "does", "doing", "down", "during", "each", "every", "from",
  "have", "having", "here", "into", "just", "like", "made", "make", "many", "more", "most",
  "much", "must", "never", "news", "over", "really", "said", "same", "should", "some",
  "still", "such", "than", "that", "their", "them", "then", "there", "these", "they",
  "thing", "this", "those", "through", "today", "told", "under", "until", "very", "want",
  "were", "what", "when", "where", "which", "while", "with", "without", "would", "your",
  "the", "to", "of", "in", "on", "for", "is", "its", "why", "how", "here", "there", "you",
  "your", "ours", "ourselves", "theyre", "cant", "dont", "doesnt", "wont", "shouldnt", "couldnt",
]);

const GENERIC_CORPUS_TERMS = new Set([
  "actually", "already", "almost", "another", "anyone", "anything", "around", "back",
  "became", "business", "changed", "coming", "company", "companies", "completely", "content",
  "country", "destroyed", "didnt", "downfall", "entire", "everything", "exposed",
  "fans", "first", "forever", "going", "however", "internet", "look", "made",
  "making", "media", "million", "money", "movie", "music", "never", "other",
  "people", "power", "really", "right", "said", "shocked", "show", "something",
  "story", "thats", "theres", "thing", "things", "think", "time", "today",
  "video", "videos", "watching", "world", "years",
]);

const HOOK_PATTERNS = [
  "the dark", "the truth", "what happened", "how this", "why this", "nobody told", "is watching",
  "changed forever", "destroyed", "collapse", "downfall", "crisis", "scam", "fraud", "exposed",
];

const IRRELEVANT_PATTERNS = [
  "product launch", "pre order", "hands on", "new feature", "app update", "earnings report",
  "quarterly results", "series a", "api update", "developer tool", "review", "unboxing",
  "spoilers", "episode recap", "recap", "season finale", "soap opera", "the bold and the beautiful",
  "young and the restless", "march madness", "bracket", "smartphone", "last longer", "how to make",
  "tips and tricks", "opening weekend", "cast in", "now streaming", "official trailer",
];

const ROUTINE_NEWS_PATTERNS = [
  "major update",
  "major updates",
  "partner up",
  "coming to",
  "available for",
  "launches",
  "launch",
  "hands on",
  "hands-on",
  "review",
  "best deals",
  "world cup",
  "release date",
  "first look",
  "now available",
  "pre order",
  "pre-order",
  "official trailer",
  "oscars",
  "award",
  "awards",
  "march madness",
  "smartphone",
  "macbook",
  "iphone",
  "ps5",
  "xdr",
];

const ENTERTAINMENT_PROMO_DISQUALIFIERS = new Set([
  "official trailer",
  "cast in",
]);

const ENTERTAINMENT_PROMO_ROUTINE_PATTERNS = new Set([
  "first look",
  "official trailer",
]);

const GENERIC_CLUSTER_TERMS = new Set([
  "disturbing",
  "disgusting",
  "forever",
  "tried warn",
  "heres why",
  "what happened",
  "the internet",
  "internet",
  "society",
  "people",
  "world",
  "mysterious",
  "changed society",
  "economic crisis",
  "watching you",
  "dark side",
]);

const GENERIC_PHRASE_PREFIXES = [
  "how the",
  "why the",
  "what the",
  "this is",
  "here is",
  "heres",
  "nobody",
  "the dark",
  "the truth",
  "what happened",
];

const COVERAGE_MODE_PATTERNS: Array<{
  key: string;
  label: string;
  terms: string[];
}> = [
  {
    key: "institutional_failure",
    label: "Institutional Failure",
    terms: ["government", "cia", "fbi", "corruption", "cover up", "surveillance", "blackrock", "war", "policy", "power"],
  },
  {
    key: "platform_society",
    label: "Platform Society",
    terms: ["instagram", "spotify", "tiktok", "youtube", "social media", "algorithm", "platform", "privacy", "app"],
  },
  {
    key: "creator_drama",
    label: "Creator Drama",
    terms: ["streamer", "youtuber", "podcast", "creator", "mrbeast", "coffeezilla", "drama", "beef", "cancelled"],
  },
  {
    key: "celeb_scandal",
    label: "Celebrity Scandal",
    terms: ["celebrity", "hollywood", "drake", "kanye", "diddy", "epstein", "actor", "music", "scandal"],
  },
  {
    key: "culture_economy",
    label: "Culture & Economy",
    terms: ["gen z", "housing", "rent", "economy", "dating", "loneliness", "society", "women", "men"],
  },
  {
    key: "scam_fraud",
    label: "Scam & Fraud",
    terms: ["scam", "fraud", "scheme", "crypto", "ponzi", "rug pull", "grifter", "lawsuit"],
  },
];

interface WeightedTerm {
  term: string;
  weight: number;
}

interface MoonAnalog {
  clipId: string;
  title: string;
  sourceUrl: string | null;
  previewUrl: string | null;
  uploadDate: string | null;
  durationMs: number | null;
  viewCount: number | null;
  clusterKey: string | null;
  clusterLabel: string | null;
  coverageMode: string | null;
  similarityScore: number;
}

export interface MoonCorpusScoreResult {
  moonFitScore: number;
  moonFitBand: "high" | "medium" | "low";
  clusterKey: string | null;
  clusterLabel: string | null;
  coverageMode: string | null;
  analogs: MoonAnalog[];
  analogMedianViews: number | null;
  analogMedianDurationMinutes: number | null;
  reasonCodes: string[];
  disqualifierCodes: string[];
}

export interface MoonScriptAnalysis {
  moonStoryFit: number;
  moonFitBand: "high" | "medium" | "low";
  likelyVertical: string | null;
  coverageMode: string | null;
  analogClipIds: string[];
  analogTitles: string[];
  hookStyle: string | null;
  expectedVisualMix: string[];
  primaryEntities: string[];
  secondaryEntities: string[];
  searchKeywords: string[];
  archiveKeywords: string[];
  youtubeKeywords: string[];
  reasonCodes: string[];
}

export interface MoonEditorialStyleGuide {
  sampleSize: number;
  dominantCoverageModes: string[];
  exemplarTitles: string[];
  referenceTitles: string[];
  storySpecificNotes: string[];
  medianWordCount: number | null;
  medianDurationMinutes: number | null;
  medianWordsPerMinute: number | null;
  openerPatterns: string[];
  phrasingPatterns: string[];
  pacingPatterns: string[];
  quotePatterns: string[];
  structurePatterns: string[];
  transitionPatterns: string[];
  antiPatterns: string[];
}

interface CorpusVideoRow {
  clipId: string;
  title: string;
  sourceUrl: string | null;
  previewUrl: string | null;
  uploadDate: string | null;
  durationMs: number | null;
  viewCount: number | null;
  metadataJson: unknown;
  transcript: string;
  wordCount: number;
}

interface CorpusProfileRecord {
  clipId: string;
  title: string;
  sourceUrl: string | null;
  previewUrl: string | null;
  uploadDate: string | null;
  durationMs: number | null;
  viewCount: number | null;
  viewPercentile: number;
  recencyWeight: number;
  durationBucket: string;
  coverageMode: string | null;
  verticalGuess: string | null;
  titleTerms: WeightedTerm[];
  transcriptTerms: WeightedTerm[];
  namedEntities: string[];
  hookTerms: string[];
  styleTerms: string[];
  combinedVector: Map<string, number>;
  clusterKey: string | null;
  clusterLabel: string | null;
  wordCount: number;
  sourcePublishedAt: Date | null;
}

interface SnapshotProfile {
  clipId: string;
  title: string;
  sourceUrl: string | null;
  previewUrl: string | null;
  uploadDate: string | null;
  durationMs: number | null;
  viewCount: number | null;
  clusterKey: string | null;
  clusterLabel: string | null;
  coverageMode: string | null;
  verticalGuess: string | null;
  recencyWeight: number;
  titleTerms: WeightedTerm[];
  transcriptTerms: WeightedTerm[];
  namedEntities: string[];
  hookTerms: string[];
  styleTerms: string[];
  combinedVector: Map<string, number>;
}

interface CorpusSnapshot {
  profileVersion: number;
  profiles: SnapshotProfile[];
  terms: Array<{ term: string; termType: string; weight: number; lift: number }>;
  clusters: Array<{ clusterKey: string; label: string; coverageMode: string | null; keywords: string[] }>;
}

let snapshotCache: CorpusSnapshot | null = null;

function coerceObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isGenericClusterTerm(term: string) {
  const normalized = term.trim().toLowerCase();
  if (GENERIC_CLUSTER_TERMS.has(normalized)) {
    return true;
  }

  return normalized.split(" ").every((token) => token.length < 5 || STOPWORDS.has(token));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeText(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function extractCapitalizedEntities(title: string): string[] {
  const matches = title.match(/\b(?:[A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,3})\b/g) ?? [];
  return Array.from(
    new Set(
      matches
        .map((match) => match.trim())
        .filter((match) => match.length >= 3)
        .filter((match) => !isNoiseTerm(match))
    )
  ).slice(0, 8);
}

function isNoiseTerm(term: string) {
  const normalized = normalizeText(term);
  if (!normalized) {
    return true;
  }

  if (GENERIC_CORPUS_TERMS.has(normalized) || GENERIC_CLUSTER_TERMS.has(normalized)) {
    return true;
  }

  if (ROUTINE_NEWS_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  if (GENERIC_PHRASE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  if (tokens.length === 1) {
    return STOPWORDS.has(tokens[0]) || GENERIC_CORPUS_TERMS.has(tokens[0]);
  }

  return tokens.every((token) => STOPWORDS.has(token) || GENERIC_CORPUS_TERMS.has(token));
}

function hasEntertainmentPromoBacklash(text: string) {
  const normalized = normalizeText(text);

  return (
    /\b(trailer|teaser|first look|casting|cast|remake|reboot|live action|cgi)\b/.test(
      normalized
    ) &&
    /\b(backlash|hate|hating|mocked|mocking|roasted|dragged|ratioed|panned|review bomb|review bombing|clowned|ugly cgi|disaster|meltdown)\b/.test(
      normalized
    )
  );
}

function isSpecificTerm(term: string) {
  const normalized = normalizeText(term);
  if (!normalized || isNoiseTerm(normalized)) {
    return false;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length >= 2) {
    return true;
  }

  return tokens[0].length >= 5 && !STOPWORDS.has(tokens[0]) && !GENERIC_CORPUS_TERMS.has(tokens[0]);
}

function isSpecificClusterLabel(term: string, corpusDocumentFrequencies: Map<string, number>) {
  const normalized = normalizeText(term);
  if (!normalized || !isSpecificTerm(normalized)) {
    return false;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length >= 2) {
    return true;
  }

  const documentFrequency = corpusDocumentFrequencies.get(normalized) ?? 0;
  return documentFrequency > 0 && documentFrequency <= 12;
}

function buildWeightedTerms(text: string, options: { includeBigrams: boolean; limit: number; baseWeight: number }) {
  const tokens = tokenizeText(text);
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + options.baseWeight);
  }

  if (options.includeBigrams) {
    for (let index = 0; index < tokens.length - 1; index += 1) {
      const bigram = `${tokens[index]} ${tokens[index + 1]}`;
      if (bigram.length < 7) {
        continue;
      }
      counts.set(bigram, (counts.get(bigram) ?? 0) + options.baseWeight * 1.6);
    }
  }

  return Array.from(counts.entries())
    .filter(([term]) => !isNoiseTerm(term))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, options.limit)
    .map(([term, weight]) => ({ term, weight: Number(weight.toFixed(3)) }));
}

function buildVector(titleTerms: WeightedTerm[], transcriptTerms: WeightedTerm[]) {
  const vector = new Map<string, number>();

  for (const item of titleTerms) {
    vector.set(item.term, (vector.get(item.term) ?? 0) + item.weight * 1.8);
  }

  for (const item of transcriptTerms) {
    vector.set(item.term, (vector.get(item.term) ?? 0) + item.weight);
  }

  return vector;
}

function vectorMagnitude(vector: Map<string, number>) {
  let total = 0;
  for (const value of vector.values()) {
    total += value * value;
  }
  return Math.sqrt(total);
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let dot = 0;
  for (const [term, value] of left.entries()) {
    const other = right.get(term);
    if (other) {
      dot += value * other;
    }
  }

  const denominator = vectorMagnitude(left) * vectorMagnitude(right);
  if (!denominator) {
    return 0;
  }

  return dot / denominator;
}

function parseMaybeDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeRecencyWeight(uploadDate: string | null) {
  const parsed = parseMaybeDate(uploadDate);
  if (!parsed) {
    return 1;
  }

  const ageDays = Math.max(0, (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
  // The last 90 days represent Moon's current editorial taste and should dominate corpus learning.
  if (ageDays <= RECENT_WINDOW_DAYS) {
    return 5;
  }

  const decay = Math.exp(-((ageDays - RECENT_WINDOW_DAYS) / 365));
  return Number(Math.max(1, 1 + 4 * decay).toFixed(2));
}

function computeViewPercentiles(rows: CorpusVideoRow[]) {
  const sorted = [...rows].sort((left, right) => (left.viewCount ?? 0) - (right.viewCount ?? 0));
  const percentiles = new Map<string, number>();

  sorted.forEach((row, index) => {
    const percentile = sorted.length <= 1 ? 1 : index / (sorted.length - 1);
    percentiles.set(row.clipId, Number(percentile.toFixed(4)));
  });

  return percentiles;
}

function inferDurationBucket(durationMs: number | null) {
  const minutes = (durationMs ?? 0) / 60000;
  if (minutes < 8) return "short";
  if (minutes < 15) return "mid";
  if (minutes < 25) return "long";
  return "deep";
}

function inferCoverageMode(title: string, transcript: string) {
  const haystack = `${title} ${transcript}`.toLowerCase();
  let best = COVERAGE_MODE_PATTERNS[0];
  let bestScore = 0;

  for (const mode of COVERAGE_MODE_PATTERNS) {
    const score = mode.terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = mode;
    }
  }

  return bestScore > 0 ? best.key : null;
}

function inferVerticalGuess(title: string, transcript: string) {
  const text = `${title} ${transcript}`.toLowerCase();
  if (/(government|cia|fbi|corruption|war|policy|surveillance)/.test(text)) return "Government / Corruption";
  if (/(instagram|spotify|youtube|tiktok|privacy|algorithm|ai)/.test(text)) return "Big Tech / Billionaires";
  if (/(streamer|youtuber|creator|podcast|mrbeast|coffeezilla|drama)/.test(text)) return "Internet Drama";
  if (/(diddy|epstein|drake|kanye|celebrity|hollywood)/.test(text)) return "Celebrity / Hollywood";
  if (/(scam|fraud|crypto|ponzi|grifter)/.test(text)) return "Scams & Fraud";
  if (/(gen z|society|housing|rent|dating|women|men|loneliness)/.test(text)) return "Social Issues / Culture";
  return null;
}

function inferHookTerms(title: string) {
  const normalized = title.toLowerCase();
  return HOOK_PATTERNS.filter((pattern) => normalized.includes(pattern)).slice(0, 6);
}

function inferStyleTerms(titleTerms: WeightedTerm[], transcriptTerms: WeightedTerm[]) {
  return Array.from(
    new Set([...titleTerms.slice(0, 6), ...transcriptTerms.slice(0, 10)].map((item) => item.term))
  ).slice(0, 12);
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .map((part) => (part.length > 0 ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function formatCoverageModeLabel(value: string | null) {
  if (!value) {
    return null;
  }

  return titleCase(value.replace(/_/g, " "));
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function medianDecimal(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;

  return Number(value.toFixed(1));
}

function cleanTranscriptText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function splitTranscriptWords(value: string) {
  return cleanTranscriptText(value).split(/\s+/).filter(Boolean);
}

function takeWordExcerpt(value: string, start: number, count: number) {
  return splitTranscriptWords(value).slice(start, start + count).join(" ");
}

function openerStartsWithImagine(value: string) {
  return /^imagine\b/i.test(cleanTranscriptText(value));
}

function openerStartsWithQuestion(value: string) {
  const opener = takeWordExcerpt(value, 0, 90);
  return /\?/.test(opener) || /^(how|why|what)\b/i.test(opener);
}

function openerUsesDirectAddress(value: string) {
  const opener = takeWordExcerpt(value, 0, 120).toLowerCase();
  return /\byou\b|\byour\b/.test(opener);
}

function openerFrontLoadsNumbers(value: string) {
  const opener = takeWordExcerpt(value, 0, 120);
  return /\b\d+\b/.test(opener);
}

function openerIntroducesContrast(value: string) {
  const opener = takeWordExcerpt(value, 0, 160).toLowerCase();
  return /\band yet\b|\bbut\b|\bhowever\b|\bwhile\b/.test(opener);
}

function describeOpenerMode(value: string) {
  if (openerStartsWithImagine(value)) {
    return "compressed hypothetical that makes the viewer inhabit the pressure immediately";
  }

  if (openerStartsWithQuestion(value)) {
    return "question-led mystery that turns the opening into an investigation";
  }

  if (openerIntroducesContrast(value)) {
    return "contradiction-led opening that stacks specifics before asking how this makes sense";
  }

  if (openerUsesDirectAddress(value)) {
    return "direct-address opening that pulls the viewer into the stakes before expanding the system";
  }

  return "hard-claim opening that starts with a destabilizing fact instead of neutral setup";
}

function getQuoteMarkerProfile(value: string) {
  const markers = (value.match(/>>|"/g) ?? []).length;
  const tokens = splitTranscriptWords(value);
  const quartiles = [0, 0, 0, 0];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.includes(">>") || token.includes("\"")) {
      const quartileIndex = Math.min(3, Math.floor((index / Math.max(1, tokens.length)) * 4));
      quartiles[quartileIndex] += 1;
    }
  }

  return { markers, quartiles };
}

function summarizeTransitionSignals(values: string[]) {
  const totals = {
    because: 0,
    but: 0,
    so: 0,
    however: 0,
    instead: 0,
    meanwhile: 0,
  };

  for (const value of values) {
    const lowered = cleanTranscriptText(value).toLowerCase();
    totals.because += (lowered.match(/\bbecause\b/g) ?? []).length;
    totals.but += (lowered.match(/\bbut\b/g) ?? []).length;
    totals.so += (lowered.match(/\bso\b/g) ?? []).length;
    totals.however += (lowered.match(/\bhowever\b/g) ?? []).length;
    totals.instead += (lowered.match(/\binstead\b/g) ?? []).length;
    totals.meanwhile += (lowered.match(/\bmeanwhile\b/g) ?? []).length;
  }

  return Object.entries(totals)
    .sort((left, right) => right[1] - left[1])
    .filter(([, value]) => value > 0)
    .slice(0, 3)
    .map(([key]) => key);
}

function dedupeByClipId<T extends { clipId: string }>(items: T[]) {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    if (seen.has(item.clipId)) {
      continue;
    }
    seen.add(item.clipId);
    deduped.push(item);
  }

  return deduped;
}

async function loadAllMoonVideoRows(): Promise<CorpusVideoRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      clipId: clipLibrary.id,
      title: clipLibrary.title,
      sourceUrl: clipLibrary.sourceUrl,
      previewUrl: clipLibrary.previewUrl,
      uploadDate: clipLibrary.uploadDate,
      durationMs: clipLibrary.durationMs,
      viewCount: clipLibrary.viewCount,
      metadataJson: clipLibrary.metadataJson,
      channelOrContributor: clipLibrary.channelOrContributor,
      transcript: transcriptCache.fullText,
      wordCount: transcriptCache.wordCount,
    })
    .from(clipLibrary)
    .leftJoin(transcriptCache, and(eq(transcriptCache.clipId, clipLibrary.id), eq(transcriptCache.language, "en")));

  return rows
    .filter((row) => row.channelOrContributor === "Moon" || coerceObject(row.metadataJson)?.isMoonVideo === true)
    .map((row) => ({
      clipId: row.clipId,
      title: row.title,
      sourceUrl: row.sourceUrl,
      previewUrl: row.previewUrl,
      uploadDate: row.uploadDate,
      durationMs: row.durationMs,
      viewCount: row.viewCount,
      metadataJson: row.metadataJson,
      transcript: row.transcript ?? "",
      wordCount: row.wordCount ?? 0,
    }));
}

function parseWeightedTerms(value: unknown): WeightedTerm[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is { term?: unknown; weight?: unknown } => Boolean(item) && typeof item === "object")
    .map((item) => ({
      term: typeof item.term === "string" ? item.term : "",
      weight: typeof item.weight === "number" ? item.weight : 0,
    }))
    .filter((item) => item.term.length > 0 && item.weight > 0);
}

async function loadSnapshot(): Promise<CorpusSnapshot> {
  if (snapshotCache) {
    return snapshotCache;
  }

  const db = getDb();
  const [profileRows, termRows, clusterRows] = await Promise.all([
    db
      .select({ profile: moonVideoProfiles, clip: clipLibrary })
      .from(moonVideoProfiles)
      .innerJoin(clipLibrary, eq(clipLibrary.id, moonVideoProfiles.clipId))
      .where(eq(moonVideoProfiles.profileVersion, MOON_CORPUS_PROFILE_VERSION)),
    db
      .select()
      .from(moonCorpusTerms)
      .where(eq(moonCorpusTerms.profileVersion, MOON_CORPUS_PROFILE_VERSION)),
    db
      .select()
      .from(moonCorpusClusters)
      .where(eq(moonCorpusClusters.profileVersion, MOON_CORPUS_PROFILE_VERSION)),
  ]);

  snapshotCache = {
    profileVersion: MOON_CORPUS_PROFILE_VERSION,
    profiles: profileRows.map(({ profile, clip }) => ({
      clipId: profile.clipId,
      title: clip.title,
      sourceUrl: clip.sourceUrl,
      previewUrl: clip.previewUrl,
      uploadDate: clip.uploadDate,
      durationMs: clip.durationMs,
      viewCount: clip.viewCount,
      clusterKey: profile.clusterKey,
      clusterLabel: profile.clusterLabel,
      coverageMode: profile.coverageMode,
      verticalGuess: profile.verticalGuess,
      recencyWeight: profile.recencyWeight,
      titleTerms: parseWeightedTerms(profile.titleTermsJson),
      transcriptTerms: parseWeightedTerms(profile.transcriptTermsJson),
      namedEntities: coerceStringArray(profile.namedEntitiesJson),
      hookTerms: coerceStringArray(profile.hookTermsJson),
      styleTerms: coerceStringArray(profile.styleTermsJson),
      combinedVector: buildVector(parseWeightedTerms(profile.titleTermsJson), parseWeightedTerms(profile.transcriptTermsJson)),
    })),
    terms: termRows.map((row) => ({ term: row.term, termType: row.termType, weight: row.weight, lift: row.lift })),
    clusters: clusterRows.map((row) => ({
      clusterKey: row.clusterKey,
      label: row.label,
      coverageMode: row.coverageMode,
      keywords: coerceStringArray(row.keywordsJson),
    })),
  };

  return snapshotCache;
}

export async function getMoonEditorialStyleGuide(args?: {
  analogClipIds?: string[];
  coverageMode?: string | null;
}): Promise<MoonEditorialStyleGuide> {
  await ensureMoonCorpusAnalysis();
  const snapshot = await loadSnapshot();
  const rows = await loadAllMoonVideoRows();
  const rowByClipId = new Map(rows.map((row) => [row.clipId, row]));

  const coverageCounts = new Map<string, number>();
  for (const profile of snapshot.profiles) {
    if (!profile.coverageMode) {
      continue;
    }

    coverageCounts.set(
      profile.coverageMode,
      (coverageCounts.get(profile.coverageMode) ?? 0) + 1
    );
  }

  const dominantCoverageModes = Array.from(coverageCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([coverageMode]) => formatCoverageModeLabel(coverageMode))
    .filter((value): value is string => Boolean(value));

  const exemplarTitles: string[] = [];
  const seenTitles = new Set<string>();
  const sortedProfiles = [...snapshot.profiles].sort(
    (left, right) =>
      (right.viewCount ?? 0) - (left.viewCount ?? 0) ||
      right.recencyWeight - left.recencyWeight
  );

  for (const coverageMode of Array.from(coverageCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([value]) => value)) {
    const exemplar = sortedProfiles.find(
      (profile) =>
        profile.coverageMode === coverageMode &&
        profile.title.length > 0 &&
        !seenTitles.has(profile.title)
    );

    if (!exemplar) {
      continue;
    }

    exemplarTitles.push(exemplar.title);
    seenTitles.add(exemplar.title);
  }

  for (const profile of sortedProfiles) {
    if (exemplarTitles.length >= 6) {
      break;
    }

    if (!profile.title || seenTitles.has(profile.title)) {
      continue;
    }

    exemplarTitles.push(profile.title);
    seenTitles.add(profile.title);
  }

  const weightedProfiles = [...snapshot.profiles].sort(
    (left, right) =>
      right.recencyWeight - left.recencyWeight ||
      (right.viewCount ?? 0) - (left.viewCount ?? 0)
  );
  const analogRows = (args?.analogClipIds ?? [])
    .map((clipId) => rowByClipId.get(clipId))
    .filter((row): row is CorpusVideoRow => row != null && row.wordCount > 1400);
  const sameCoverageRows = weightedProfiles
    .filter((profile) => profile.coverageMode && profile.coverageMode === args?.coverageMode)
    .map((profile) => rowByClipId.get(profile.clipId))
    .filter((row): row is CorpusVideoRow => row != null && row.wordCount > 1400)
    .slice(0, 8);
  const representativeRows = weightedProfiles
    .map((profile) => rowByClipId.get(profile.clipId))
    .filter((row): row is CorpusVideoRow => row != null && row.wordCount > 1400)
    .slice(0, 16);
  const sampleRows = dedupeByClipId([
    ...analogRows,
    ...sameCoverageRows,
    ...representativeRows,
  ]).slice(0, 20);
  const sampleTexts = sampleRows.map((row) => cleanTranscriptText(row.transcript)).filter(Boolean);
  const sampleSize = sampleRows.length;
  const medianWordCount = median(sampleRows.map((row) => row.wordCount).filter((value) => value > 0));
  const medianDurationMinutes = medianDecimal(
    sampleRows.map((row) => (row.durationMs ?? 0) / 60000).filter((value) => value > 0)
  );
  const wordsPerMinuteValues = sampleRows
    .map((row) => {
      const minutes = (row.durationMs ?? 0) / 60000;
      if (!minutes || row.wordCount <= 0) {
        return null;
      }
      return row.wordCount / minutes;
    })
    .filter((value): value is number => value != null && value > 0);
  const medianWordsPerMinute = medianDecimal(wordsPerMinuteValues);
  const directAddressOpeners = sampleTexts.filter((text) => openerUsesDirectAddress(text)).length;
  const numberOpeners = sampleTexts.filter((text) => openerFrontLoadsNumbers(text)).length;
  const contrastOpeners = sampleTexts.filter((text) => openerIntroducesContrast(text)).length;
  const questionOpeners = sampleTexts.filter((text) => openerStartsWithQuestion(text)).length;
  const imagineOpeners = sampleTexts.filter((text) => openerStartsWithImagine(text)).length;
  const quoteProfiles = sampleTexts.map((text) => getQuoteMarkerProfile(text));
  const scriptsWithQuotes = quoteProfiles.filter((profile) => profile.markers > 0).length;
  const quoteQuartiles = quoteProfiles.reduce(
    (totals, profile) => {
      profile.quartiles.forEach((value, index) => {
        totals[index] += value;
      });
      return totals;
    },
    [0, 0, 0, 0]
  );
  const peakQuoteQuartile = quoteQuartiles.indexOf(Math.max(...quoteQuartiles));
  const quoteQuartileLabels = [
    "the first quarter, after the hook lands",
    "the second quarter, once the mechanism is clear",
    "the third quarter, around the main reveal or system turn",
    "the final quarter, during consequence and landing beats",
  ];
  const dominantTransitions = summarizeTransitionSignals(sampleTexts);
  const referenceTitles = sampleRows.slice(0, 8).map((row) => row.title);
  const storySpecificNotes = analogRows
    .slice(0, 4)
    .map((row) => `${row.title}: ${describeOpenerMode(row.transcript)}`);

  return {
    sampleSize,
    dominantCoverageModes,
    exemplarTitles,
    referenceTitles,
    storySpecificNotes,
    medianWordCount,
    medianDurationMinutes,
    medianWordsPerMinute,
    openerPatterns: [
      sampleSize > 0
        ? `Open on a destabilizing claim, contradiction, or compressed scenario immediately. In the current Moon sample, ${contrastOpeners}/${sampleSize} openers introduce tension inside the first 160 words and ${numberOpeners}/${sampleSize} front-load a hard number, count, or concrete factual detail.`
        : "Open on a destabilizing claim, contradiction, or compressed scenario immediately.",
      sampleSize > 0
        ? `Direct address is common when it sharpens stakes rather than selling hype: ${directAddressOpeners}/${sampleSize} openings use “you” or “your” in the first 120 words.`
        : "Use direct address only when it sharpens the stakes for the viewer.",
      questionOpeners > 0
        ? `Question-led openings are used selectively, not constantly: ${questionOpeners}/${sampleSize} sample openings begin as a direct question, while ${imagineOpeners}/${sampleSize} begin with a compressed hypothetical.`
        : "Question-led openings should be selective and only when the question itself creates the tension.",
      "Reach the unsettling implication before backstory. Do not spend the opener on neutral setup, context dumping, or thesis throat-clearing.",
    ],
    phrasingPatterns: [
      "Write in spoken, declarative sentence clusters rather than essay paragraphs. Concrete nouns, institutions, products, money, policies, and names come before abstraction.",
      "Moon phrasing tends to compress claim plus proof into the same breath: state the anomaly, then immediately pin it to a number, behavior, or institution.",
      "Escalate with precise specifics, not with melodramatic adjectives. If the material is strong, the line can stay calm.",
    ],
    pacingPatterns: [
      medianWordCount && medianDurationMinutes && medianWordsPerMinute
        ? `Representative Moon scripts are substantial: median sample length is about ${medianWordCount} words over ${medianDurationMinutes} minutes, or roughly ${medianWordsPerMinute} spoken words per minute. Do not hand in a thin summary draft.`
        : "Representative Moon scripts are substantial. Do not hand in a thin summary draft.",
      "Alternate pressure and explanation. Every context paragraph should cash out why the detail matters before the script moves on.",
      "The script should widen in stages: anomaly first, mechanism second, system third, human cost or reveal fourth, consequence or warning last.",
    ],
    quotePatterns: [
      sampleSize > 0
        ? `Moon scripts do not depend on long quote walls. In the current sample, only ${scriptsWithQuotes}/${sampleSize} transcripts contain obvious clipped-dialogue markers, which means quote beats should puncture the narration rather than replace it.`
        : "Use quotes as puncture beats, not as the main narration voice.",
      quoteQuartiles.some((value) => value > 0)
        ? `When transcript-style quote interruptions show up, they cluster most around ${quoteQuartileLabels[Math.max(0, peakQuoteQuartile)]}. That means the hook should usually work before the first heavy quote beat arrives.`
        : "If transcript-backed quotes exist, use them after the hook has momentum instead of opening with a block of quoted material.",
      "Prefer short, sayable receipts that verify or sharpen a beat. If a quote is long, break it or paraphrase around the strongest fragment instead of building a quote wall.",
      "Attach visible inline sourcing whenever a factual claim or quote is carrying weight.",
    ],
    structurePatterns: [
      "Beat 1: anomaly, contradiction, or unsettling scenario.",
      "Beat 2: mechanism or origin story that explains how the anomaly became possible.",
      "Beat 3: widen from the incident into incentives, institutions, markets, or culture.",
      "Beat 4: deliver the turn, hidden layer, human cost, or proof that the problem is structural.",
      "Beat 5: land on consequence, warning, or unresolved pressure rather than a clean moral recap.",
    ],
    transitionPatterns: [
      dominantTransitions.length > 0
        ? `Moon transitions are usually causal rather than theatrical. The strongest connective language in the sample is ${dominantTransitions.join(", ")}.`
        : "Use causal transitions that feel like consequence or pressure, not theatrical signposts.",
      "Let the next fact force the pivot. A section should turn because the evidence becomes harder to ignore, not because the script announces a turn.",
      "Context paragraphs should not stall momentum; they should reveal why the previous fact is bigger, stranger, or more dangerous than it first looked.",
    ],
    antiPatterns: [
      "Do not open with a bloggy summary of the topic.",
      "Do not use canned AI contrast templates or stock signposts to fake momentum.",
      "Do not front-load background before the contradiction is clear.",
      "Do not scatter weak quotes through every section. Use fewer, stronger quote beats.",
      "Do not end with a tidy recap if the stronger Moon move is to leave consequence, warning, or unresolved pressure hanging.",
    ],
  };
}

export async function rebuildMoonCorpusAnalysis() {
  const db = getDb();
  const rows = await loadAllMoonVideoRows();
  const viewPercentiles = computeViewPercentiles(rows);

  const profiles: CorpusProfileRecord[] = rows.map((row) => {
    const titleTerms = buildWeightedTerms(row.title, {
      includeBigrams: true,
      limit: TOP_TITLE_TERMS,
      baseWeight: 3,
    });
    const transcriptTerms = buildWeightedTerms(row.transcript, {
      includeBigrams: false,
      limit: TOP_TRANSCRIPT_TERMS,
      baseWeight: 1,
    });
    const coverageMode = inferCoverageMode(row.title, row.transcript);
    const sourcePublishedAt = parseMaybeDate(row.uploadDate);

    return {
      clipId: row.clipId,
      title: row.title,
      sourceUrl: row.sourceUrl,
      previewUrl: row.previewUrl,
      uploadDate: row.uploadDate,
      durationMs: row.durationMs,
      viewCount: row.viewCount,
      viewPercentile: viewPercentiles.get(row.clipId) ?? 0,
      recencyWeight: computeRecencyWeight(row.uploadDate),
      durationBucket: inferDurationBucket(row.durationMs),
      coverageMode,
      verticalGuess: inferVerticalGuess(row.title, row.transcript),
      titleTerms,
      transcriptTerms,
      namedEntities: extractCapitalizedEntities(row.title),
      hookTerms: inferHookTerms(row.title),
      styleTerms: inferStyleTerms(titleTerms, transcriptTerms),
      combinedVector: buildVector(titleTerms, transcriptTerms),
      clusterKey: null,
      clusterLabel: null,
      wordCount: row.wordCount,
      sourcePublishedAt,
    };
  });

  const termStats = new Map<string, {
    termType: string;
    documentFrequency: number;
    weightedDocumentFrequency: number;
    exampleClipIds: Set<string>;
  }>();

  for (const profile of profiles) {
    const uniqueTerms = new Map<string, string>();
    for (const item of profile.titleTerms) {
      uniqueTerms.set(item.term, item.term.includes(" ") ? "phrase" : "keyword");
    }
    for (const item of profile.transcriptTerms) {
      if (!uniqueTerms.has(item.term)) {
        uniqueTerms.set(item.term, item.term.includes(" ") ? "phrase" : "keyword");
      }
    }

    for (const [term, termType] of uniqueTerms.entries()) {
      const stat = termStats.get(term) ?? {
        termType,
        documentFrequency: 0,
        weightedDocumentFrequency: 0,
        exampleClipIds: new Set<string>(),
      };
      stat.documentFrequency += 1;
      stat.weightedDocumentFrequency += profile.recencyWeight;
      if (stat.exampleClipIds.size < 6) {
        stat.exampleClipIds.add(profile.clipId);
      }
      termStats.set(term, stat);
    }
  }

  const corpusTerms = Array.from(termStats.entries())
    .map(([term, stat]) => {
      const idf = Math.log((profiles.length + 1) / (stat.documentFrequency + 1));
      const lift = Number((stat.weightedDocumentFrequency * idf).toFixed(4));
      const weight = Number((lift * (term.includes(" ") ? 1.25 : 1)).toFixed(4));
      return {
        term,
        termType: stat.termType,
        documentFrequency: stat.documentFrequency,
        weightedDocumentFrequency: Number(stat.weightedDocumentFrequency.toFixed(4)),
        weight,
        lift,
        exampleClipIds: Array.from(stat.exampleClipIds),
      };
    })
    .filter((item) => {
      const maxDocumentFrequency = Math.min(
        MAX_CORPUS_TERM_DOCUMENT_COUNT,
        Math.max(12, Math.floor(profiles.length * MAX_CORPUS_TERM_DOCUMENT_SHARE))
      );
      return item.documentFrequency >= 2
        && item.documentFrequency <= maxDocumentFrequency
        && !isGenericClusterTerm(item.term)
        && !isNoiseTerm(item.term)
        && isSpecificTerm(item.term);
    })
    .sort((left, right) => right.weight - left.weight || left.term.localeCompare(right.term))
    .slice(0, TOP_CORPUS_TERMS);

  const clusterGroups = new Map<string, CorpusProfileRecord[]>();
  const corpusDocumentFrequencies = new Map(corpusTerms.map((term) => [term.term, term.documentFrequency]));
  for (const profile of profiles) {
    const entityCandidates = profile.namedEntities
      .map((entity) => normalizeText(entity))
      .filter((term) => isSpecificClusterLabel(term, corpusDocumentFrequencies));
    const phraseCandidates = profile.titleTerms
      .map((item) => item.term)
      .filter(
        (term) =>
          term.includes(" ") &&
          isSpecificClusterLabel(term, corpusDocumentFrequencies) &&
          corpusTerms.some((corpusTerm) => corpusTerm.term === term && corpusTerm.documentFrequency >= 2)
      );
    const chosen = entityCandidates[0] ?? phraseCandidates[0] ?? profile.coverageMode ?? "moon_general";
    profile.clusterKey = slugify(chosen);
    profile.clusterLabel = titleCase(chosen.replace(/-/g, " "));
    const group = clusterGroups.get(profile.clusterKey) ?? [];
    group.push(profile);
    clusterGroups.set(profile.clusterKey, group);
  }

  const clusters = Array.from(clusterGroups.entries())
    .map(([clusterKey, members]) => {
      const label = members[0]?.clusterLabel ?? titleCase(clusterKey.replace(/-/g, " "));
      const coverageCounts = new Map<string, number>();
      const keywordCounts = new Map<string, number>();
      const entityCounts = new Map<string, number>();
      for (const member of members) {
        if (member.coverageMode) {
          coverageCounts.set(member.coverageMode, (coverageCounts.get(member.coverageMode) ?? 0) + 1);
        }
        for (const item of member.titleTerms.slice(0, 6)) {
          if (!isNoiseTerm(item.term)) {
            keywordCounts.set(item.term, (keywordCounts.get(item.term) ?? 0) + 1);
          }
        }
        for (const entity of member.namedEntities) {
          if (!isNoiseTerm(entity)) {
            entityCounts.set(entity, (entityCounts.get(entity) ?? 0) + 1);
          }
        }
      }
      const keywords = Array.from(keywordCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 10)
        .map(([term]) => term);
      const entityKeys = Array.from(entityCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 8)
        .map(([entity]) => entity);
      const exampleClipIds = members
        .slice()
        .sort((left, right) => (right.viewCount ?? 0) - (left.viewCount ?? 0))
        .slice(0, 6)
        .map((member) => member.clipId);
      const coverageMode = Array.from(coverageCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
      return {
        clusterKey,
        label,
        coverageMode,
        keywords,
        entityKeys,
        exampleClipIds,
        members: members.length,
      };
    })
    .sort((left, right) => right.members - left.members || left.label.localeCompare(right.label))
    .slice(0, TOP_CLUSTERS);

  const allowedClusterKeys = new Set(clusters.map((cluster) => cluster.clusterKey));
  for (const profile of profiles) {
    if (!profile.clusterKey || !allowedClusterKeys.has(profile.clusterKey)) {
      const fallbackCluster = profile.coverageMode ?? "moon_general";
      profile.clusterKey = slugify(fallbackCluster);
      profile.clusterLabel = titleCase(fallbackCluster.replace(/_/g, " "));
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(moonStoryScores);
    await tx.delete(moonCorpusClusters);
    await tx.delete(moonCorpusTerms);
    await tx.delete(moonVideoProfiles);

    if (profiles.length > 0) {
      await tx.insert(moonVideoProfiles).values(
        profiles.map((profile) => ({
          clipId: profile.clipId,
          clusterKey: profile.clusterKey,
          clusterLabel: profile.clusterLabel,
          coverageMode: profile.coverageMode,
          verticalGuess: profile.verticalGuess,
          titleTermsJson: profile.titleTerms,
          transcriptTermsJson: profile.transcriptTerms,
          namedEntitiesJson: profile.namedEntities,
          hookTermsJson: profile.hookTerms,
          styleTermsJson: profile.styleTerms,
          durationBucket: profile.durationBucket,
          viewPercentile: profile.viewPercentile,
          recencyWeight: profile.recencyWeight,
          wordCount: profile.wordCount,
          sourcePublishedAt: profile.sourcePublishedAt,
          profileVersion: MOON_CORPUS_PROFILE_VERSION,
          analyzedAt: new Date(),
          updatedAt: new Date(),
        }))
      );
    }

    if (corpusTerms.length > 0) {
      await tx.insert(moonCorpusTerms).values(
        corpusTerms.map((term) => ({
          term: term.term,
          termType: term.termType,
          documentFrequency: term.documentFrequency,
          weightedDocumentFrequency: term.weightedDocumentFrequency,
          weight: term.weight,
          lift: term.lift,
          exampleClipIdsJson: term.exampleClipIds,
          profileVersion: MOON_CORPUS_PROFILE_VERSION,
          analyzedAt: new Date(),
        }))
      );
    }

    if (clusters.length > 0) {
      await tx.insert(moonCorpusClusters).values(
        clusters.map((cluster) => ({
          clusterKey: cluster.clusterKey,
          label: cluster.label,
          coverageMode: cluster.coverageMode,
          keywordsJson: cluster.keywords,
          entityKeysJson: cluster.entityKeys,
          exampleClipIdsJson: cluster.exampleClipIds,
          profileVersion: MOON_CORPUS_PROFILE_VERSION,
          analyzedAt: new Date(),
        }))
      );
    }
  });

  snapshotCache = null;

  return {
    profileCount: profiles.length,
    corpusTermCount: corpusTerms.length,
    clusterCount: clusters.length,
  };
}

export async function ensureMoonCorpusAnalysis() {
  const db = getDb();
  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(moonVideoProfiles)
    .where(eq(moonVideoProfiles.profileVersion, MOON_CORPUS_PROFILE_VERSION));

  if ((existing[0]?.count ?? 0) > 0) {
    return { rebuilt: false };
  }

  await rebuildMoonCorpusAnalysis();
  return { rebuilt: true };
}

function buildInputVector(title: string, text: string) {
  const titleTerms = buildWeightedTerms(title, {
    includeBigrams: true,
    limit: TOP_TITLE_TERMS,
    baseWeight: 3,
  });
  const bodyTerms = buildWeightedTerms(text, {
    includeBigrams: false,
    limit: TOP_TRANSCRIPT_TERMS,
    baseWeight: 1,
  });

  return {
    titleTerms,
    bodyTerms,
    vector: buildVector(titleTerms, bodyTerms),
    namedEntities: extractCapitalizedEntities(title),
  };
}

export async function scoreTextAgainstMoonCorpus(input: {
  title: string;
  text?: string | null;
  maxAnalogs?: number;
}): Promise<MoonCorpusScoreResult> {
  await ensureMoonCorpusAnalysis();
  const snapshot = await loadSnapshot();
  const built = buildInputVector(input.title, input.text ?? "");
  const combinedText = `${input.title} ${input.text ?? ""}`.toLowerCase();
  const inputEntities = Array.from(
    new Set(extractCapitalizedEntities(`${input.title} ${input.text ?? ""}`).map((entity) => normalizeText(entity)))
  );
  const inputTerms = new Set(
    [...built.titleTerms, ...built.bodyTerms]
      .map((item) => item.term)
      .filter((term) => isSpecificTerm(term))
  );

  const scoredAnalogs = snapshot.profiles
    .map((profile) => {
      const similarity = cosineSimilarity(built.vector, profile.combinedVector);
      const profileTerms = new Set(
        [...profile.titleTerms, ...profile.transcriptTerms]
          .map((item) => item.term)
          .filter((term) => isSpecificTerm(term))
      );
      const profileEntities = new Set(profile.namedEntities.map((entity) => normalizeText(entity)).filter(Boolean));
      const sharedTerms = Array.from(inputTerms).filter((term) => profileTerms.has(term)).slice(0, 6);
      const sharedEntities = inputEntities.filter((entity) => profileEntities.has(entity)).slice(0, 4);
      const recencyFactor = Math.sqrt(Math.max(1, profile.recencyWeight));
      const specificityBonus = sharedTerms.length * 0.035 + sharedEntities.length * 0.12;
      const similarityScore = Number((similarity * recencyFactor + specificityBonus).toFixed(4));
      return {
        clipId: profile.clipId,
        title: profile.title,
        sourceUrl: profile.sourceUrl,
        previewUrl: profile.previewUrl,
        uploadDate: profile.uploadDate,
        durationMs: profile.durationMs,
        viewCount: profile.viewCount,
        clusterKey: profile.clusterKey,
        clusterLabel: profile.clusterLabel,
        coverageMode: profile.coverageMode,
        similarityScore,
        sharedTerms,
        sharedEntities,
      };
    })
    .filter((analog) => analog.similarityScore > 0.05)
    .sort((left, right) => right.similarityScore - left.similarityScore || (right.viewCount ?? 0) - (left.viewCount ?? 0))
    .slice(0, input.maxAnalogs ?? MAX_ANALOGS);
  const analogs = scoredAnalogs.map((analog) => ({
    clipId: analog.clipId,
    title: analog.title,
    sourceUrl: analog.sourceUrl,
    previewUrl: analog.previewUrl,
    uploadDate: analog.uploadDate,
    durationMs: analog.durationMs,
    viewCount: analog.viewCount,
    clusterKey: analog.clusterKey,
    clusterLabel: analog.clusterLabel,
    coverageMode: analog.coverageMode,
    similarityScore: analog.similarityScore,
  }));

  const matchedTerms = new Set([
    ...built.titleTerms.map((item) => item.term),
    ...built.bodyTerms.map((item) => item.term),
  ]);

  const matchedCorpusTerms = snapshot.terms.filter(
    (term) => matchedTerms.has(term.term) && !isGenericClusterTerm(term.term) && isSpecificTerm(term.term)
  );
  const matchedTermSignal = matchedCorpusTerms.reduce((total, term) => total + term.weight, 0);
  const specificEntityHits = scoredAnalogs.reduce((total, analog) => total + analog.sharedEntities.length, 0);
  const specificPhraseHits = scoredAnalogs.reduce((total, analog) => total + analog.sharedTerms.length, 0);
  const topAnalog = analogs[0]?.similarityScore ?? 0;
  const avgAnalog = analogs.length > 0
    ? analogs.reduce((total, analog) => total + analog.similarityScore, 0) / analogs.length
    : 0;

  const clusterVotes = new Map<string, number>();
  const clusterLabels = new Map<string, string>();
  const coverageVotes = new Map<string, number>();
  for (const analog of analogs) {
    if (analog.clusterKey) {
      clusterVotes.set(analog.clusterKey, (clusterVotes.get(analog.clusterKey) ?? 0) + analog.similarityScore);
      if (analog.clusterLabel) {
        clusterLabels.set(analog.clusterKey, analog.clusterLabel);
      }
    }
    if (analog.coverageMode) {
      coverageVotes.set(analog.coverageMode, (coverageVotes.get(analog.coverageMode) ?? 0) + analog.similarityScore);
    }
  }

  const rawClusterKey = Array.from(clusterVotes.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const rawClusterLabel = rawClusterKey ? clusterLabels.get(rawClusterKey) ?? titleCase(rawClusterKey.replace(/-/g, " ")) : null;
  const clusterKey = rawClusterLabel && !isNoiseTerm(rawClusterLabel) ? rawClusterKey : null;
  const clusterLabel = rawClusterLabel && !isNoiseTerm(rawClusterLabel) ? rawClusterLabel : null;
  const coverageMode = Array.from(coverageVotes.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  const entertainmentPromoBacklash = hasEntertainmentPromoBacklash(combinedText);
  const disqualifierCodes = IRRELEVANT_PATTERNS
    .filter(
      (pattern) =>
        combinedText.includes(pattern) &&
        !(
          entertainmentPromoBacklash &&
          ENTERTAINMENT_PROMO_DISQUALIFIERS.has(pattern)
        )
    )
    .map((pattern) => `irrelevant:${pattern}`);
  const routineNewsCodes = ROUTINE_NEWS_PATTERNS
    .filter(
      (pattern) =>
        combinedText.includes(pattern) &&
        !(
          entertainmentPromoBacklash &&
          ENTERTAINMENT_PROMO_ROUTINE_PATTERNS.has(pattern)
        )
    )
    .map((pattern) => `routine:${pattern}`);

  const baseScore = Math.min(
    100,
    Math.round(
      topAnalog * 52
      + avgAnalog * 24
      + Math.min(28, matchedTermSignal * 1.7)
      + Math.min(18, specificEntityHits * 7 + specificPhraseHits * 2)
    )
  );
  const penalty = disqualifierCodes.length * 25 + routineNewsCodes.length * 18;
  const hasHardDisqualifier = disqualifierCodes.length > 0;
  const weakSpecificity = topAnalog < 0.38 && matchedTermSignal < 7 && specificEntityHits === 0 && specificPhraseHits < 2;
  const uncappedScore = Math.max(0, Math.min(100, baseScore - penalty));
  const lowSpecificityCap = routineNewsCodes.length > 0 ? 25 : 55;
  const moonFitScore = hasHardDisqualifier
    ? Math.min(35, uncappedScore)
    : weakSpecificity
      ? Math.min(lowSpecificityCap, uncappedScore)
      : uncappedScore >= 70 && specificEntityHits === 0 && matchedCorpusTerms.length < 2
        ? Math.min(55, uncappedScore)
        : uncappedScore;
  const moonFitBand = moonFitScore >= 70 ? "high" : moonFitScore >= 40 ? "medium" : "low";

  const analogViewMedian = median(analogs.map((analog) => analog.viewCount ?? 0).filter((value) => value > 0));
  const analogDurationMedian = median(analogs.map((analog) => Math.round((analog.durationMs ?? 0) / 60000)).filter((value) => value > 0));

  const reasonCodes: string[] = [];
  if (clusterLabel) {
    reasonCodes.push(`cluster:${clusterLabel}`);
  }
  if (coverageMode) {
    reasonCodes.push(`coverage:${coverageMode}`);
  }
  for (const analog of analogs.slice(0, 2)) {
    reasonCodes.push(`analog:${analog.title}`);
  }
  for (const term of matchedCorpusTerms.slice(0, 3)) {
    reasonCodes.push(`term:${term.term}`);
  }
  for (const entity of inputEntities.slice(0, 2)) {
    reasonCodes.push(`entity:${entity}`);
  }

  return {
    moonFitScore,
    moonFitBand,
    clusterKey,
    clusterLabel,
    coverageMode,
    analogs,
    analogMedianViews: analogViewMedian,
    analogMedianDurationMinutes: analogDurationMedian,
    reasonCodes: Array.from(new Set(reasonCodes)).slice(0, 8),
    disqualifierCodes: [...disqualifierCodes, ...routineNewsCodes],
  };
}

async function buildStoryResearchText(storyId: string) {
  const db = getDb();
  const story = await db
    .select()
    .from(boardStoryCandidates)
    .where(eq(boardStoryCandidates.id, storyId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!story) {
    return null;
  }

  const sourceRows = await db
    .select({
      title: boardFeedItems.title,
      summary: boardFeedItems.summary,
    })
    .from(boardStorySources)
    .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId))
    .where(eq(boardStorySources.storyId, storyId));

  const text = sourceRows
    .flatMap((row) => [row.title, row.summary ?? ""])
    .filter(Boolean)
    .join("\n\n");

  return {
    story,
    text,
  };
}

export async function scoreBoardStoryWithMoonCorpus(storyId: string) {
  const db = getDb();
  const storyText = await buildStoryResearchText(storyId);
  if (!storyText) {
    return null;
  }

  const result = await scoreTextAgainstMoonCorpus({
    title: storyText.story.canonicalTitle,
    text: storyText.text,
  });

  await db
    .insert(moonStoryScores)
    .values({
      storyId,
      moonFitScore: result.moonFitScore,
      moonFitBand: result.moonFitBand,
      clusterKey: result.clusterKey,
      clusterLabel: result.clusterLabel,
      coverageMode: result.coverageMode,
      analogClipIdsJson: result.analogs.map((analog) => analog.clipId),
      analogTitlesJson: result.analogs.map((analog) => analog.title),
      analogMedianViews: result.analogMedianViews,
      analogMedianDurationMinutes: result.analogMedianDurationMinutes,
      reasonCodesJson: result.reasonCodes,
      disqualifierCodesJson: result.disqualifierCodes,
      profileVersion: MOON_CORPUS_PROFILE_VERSION,
      scoredAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: moonStoryScores.storyId,
      set: {
        moonFitScore: result.moonFitScore,
        moonFitBand: result.moonFitBand,
        clusterKey: result.clusterKey,
        clusterLabel: result.clusterLabel,
        coverageMode: result.coverageMode,
        analogClipIdsJson: result.analogs.map((analog) => analog.clipId),
        analogTitlesJson: result.analogs.map((analog) => analog.title),
        analogMedianViews: result.analogMedianViews,
        analogMedianDurationMinutes: result.analogMedianDurationMinutes,
        reasonCodesJson: result.reasonCodes,
        disqualifierCodesJson: result.disqualifierCodes,
        profileVersion: MOON_CORPUS_PROFILE_VERSION,
        scoredAt: new Date(),
        updatedAt: new Date(),
      },
    });

  return result;
}

export async function scoreBoardStoriesWithMoonCorpus(storyIds?: string[]) {
  const db = getDb();
  const rows = await db
    .select({ id: boardStoryCandidates.id })
    .from(boardStoryCandidates)
    .where(storyIds && storyIds.length > 0 ? inArray(boardStoryCandidates.id, storyIds) : sql`true`);

  for (const row of rows) {
    await scoreBoardStoryWithMoonCorpus(row.id);
  }

  return { rescoredStories: rows.length };
}

export async function getMoonStoryScoresByStoryIds(storyIds: string[]) {
  if (storyIds.length === 0) {
    return new Map();
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(moonStoryScores)
    .where(inArray(moonStoryScores.storyId, Array.from(new Set(storyIds))));

  return new Map(rows.map((row) => [row.storyId, row]));
}

export async function analyzeScriptLineWithMoonCorpus(input: {
  lineText: string;
  scriptContext?: string;
}) : Promise<MoonScriptAnalysis> {
  const result = await scoreTextAgainstMoonCorpus({
    title: input.lineText,
    text: input.scriptContext ?? "",
    maxAnalogs: 4,
  });

  const entityPool = Array.from(new Set(result.analogs.flatMap((analog) => tokenizeText(analog.title).slice(0, 3))));
  const searchKeywords = Array.from(
    new Set([
      ...tokenizeText(input.lineText).slice(0, 5),
      ...result.reasonCodes
        .filter((code) => code.startsWith("term:"))
        .map((code) => code.replace(/^term:/, "")),
      ...entityPool.slice(0, 4),
    ])
  ).slice(0, 8);

  return {
    moonStoryFit: result.moonFitScore,
    moonFitBand: result.moonFitBand,
    likelyVertical: result.coverageMode ? titleCase(result.coverageMode.replace(/_/g, " ")) : null,
    coverageMode: result.coverageMode,
    analogClipIds: result.analogs.map((analog) => analog.clipId),
    analogTitles: result.analogs.map((analog) => analog.title),
    hookStyle: result.analogs.flatMap((analog) => tokenizeText(analog.title).slice(0, 2))[0] ?? null,
    expectedVisualMix: result.coverageMode === "institutional_failure"
      ? ["archive", "documents", "maps"]
      : result.coverageMode === "creator_drama"
        ? ["clips", "screenshots", "social posts"]
        : ["clips", "b-roll", "screenshots"],
    primaryEntities: entityPool.slice(0, 4),
    secondaryEntities: entityPool.slice(4, 8),
    searchKeywords,
    archiveKeywords: searchKeywords.slice(0, 5),
    youtubeKeywords: Array.from(new Set([...entityPool.slice(0, 3), ...searchKeywords.slice(0, 3)])).slice(0, 5),
    reasonCodes: result.reasonCodes,
  };
}

export async function listMoonCorpusClusters() {
  await ensureMoonCorpusAnalysis();
  const db = getDb();
  return db
    .select()
    .from(moonCorpusClusters)
    .where(eq(moonCorpusClusters.profileVersion, MOON_CORPUS_PROFILE_VERSION));
}
