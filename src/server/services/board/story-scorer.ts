import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  boardCompetitorPosts,
  boardFeedItems,
  boardStoryCandidates,
  boardStorySources,
  clipLibrary,
} from "@/server/db/schema";
import { scoreBoardStoryWithMoonCorpus } from "@/server/services/moon-corpus";

// ─── Types ───

export interface ScoreBreakdown {
  sourceScore: number;
  controversyScore: number;
  timelinessScore: number;
  competitorOverlap: number;
  visualEvidence: number;
  moonRelevance: number;
}

export type StoryTier = "S" | "A" | "B" | "C" | "D";

export interface StoryScoreResult {
  totalScore: number;
  breakdown: ScoreBreakdown;
  tier: StoryTier;
  surgeActive: boolean;
}

// ─── Tier-1 source detection ───

const TIER1_SOURCES = [
  "nytimes.com",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "washingtonpost.com",
  "theguardian.com",
  "wsj.com",
  "cnn.com",
  "bloomberg.com",
];

function isTier1Source(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return TIER1_SOURCES.some(
      (s) => hostname === s || hostname.endsWith(`.${s}`)
    );
  } catch {
    return false;
  }
}

function getTier(score: number): StoryTier {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}

function coerceScoreJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

// ─── Score computation ───

export async function scoreStory(
  storyId: string
): Promise<StoryScoreResult> {
  const db = getDb();

  // Get the story
  const story = await db
    .select()
    .from(boardStoryCandidates)
    .where(eq(boardStoryCandidates.id, storyId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!story) {
    return {
      totalScore: 0,
      breakdown: {
        sourceScore: 0,
        controversyScore: 0,
        timelinessScore: 0,
        competitorOverlap: 0,
        visualEvidence: 0,
        moonRelevance: 0,
      },
      tier: "D",
      surgeActive: false,
    };
  }

  // Get linked feed items for tier-1 check
  const feedItems = await db
    .select({ url: boardFeedItems.url })
    .from(boardStorySources)
    .innerJoin(boardFeedItems, eq(boardStorySources.feedItemId, boardFeedItems.id))
    .where(eq(boardStorySources.storyId, storyId));

  // 1. Source Score (30pts): min(sourceCount * 3, 30) + tier-1 bonus
  const sourceCount = story.sourcesCount;
  let sourceScore = Math.min(sourceCount * 3, 30);
  const hasTier1 = feedItems.some((fi) => isTier1Source(fi.url));
  if (hasTier1) {
    sourceScore = Math.min(sourceScore + 5, 30);
  }

  // 2. Controversy Score (25pts): controversyScore * 0.25
  const controversyScore = Math.min(
    Math.round(story.controversyScore * 0.25),
    25
  );

  // 3. Timeliness — this is now a MULTIPLIER not just points
  // Recent stories get full score, old ones decay hard
  let timelinessScore = 20;
  let agePenaltyMultiplier = 1.0; // applied to total score at the end
  if (story.lastSeenAt) {
    const ageMs = Date.now() - new Date(story.lastSeenAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const ageDays = ageHours / 24;

    // Timeliness points
    if (ageHours < 6) timelinessScore = 20;
    else if (ageHours < 24) timelinessScore = 18;
    else if (ageHours < 72) timelinessScore = 15; // 3 days
    else if (ageDays < 7) timelinessScore = 10;
    else if (ageDays < 14) timelinessScore = 5;
    else timelinessScore = 0;

    // Age penalty multiplier — old stories get crushed
    // Unless they have multiple recent sources (= resurgence)
    if (ageDays > 30) agePenaltyMultiplier = 0.2;      // 1+ month = 20% of score
    else if (ageDays > 14) agePenaltyMultiplier = 0.4;  // 2+ weeks = 40%
    else if (ageDays > 7) agePenaltyMultiplier = 0.6;   // 1+ week = 60%
    else if (ageDays > 3) agePenaltyMultiplier = 0.8;   // 3+ days = 80%
    else agePenaltyMultiplier = 1.0;                    // recent = full score

    // Surge override: if story has 3+ sources in last 24h, it's resurgent
    // (handled below in surge detection)
  }

  // 4. Competitor Overlap (15pts): check if competitors cover similar topic
  let competitorOverlap = 0;
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const competitorMatches = await db
      .select({ count: sql<number>`count(*)` })
      .from(boardCompetitorPosts)
      .where(
        and(
          gte(boardCompetitorPosts.topicMatchScore, 50),
          gte(boardCompetitorPosts.publishedAt, oneDayAgo)
        )
      )
      .then((rows) => Number(rows[0]?.count ?? 0));

    if (competitorMatches > 0) competitorOverlap = 15;
  } catch {
    // Competitor check is best-effort
  }

  // 5. Visual Evidence (10pts): check if video clips exist
  let visualEvidence = 0;
  try {
    const storyTitle = story.canonicalTitle.toLowerCase();
    // Check if any clips in the library match the story topic (basic keyword match)
    const keywords = storyTitle
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 3);

    if (keywords.length > 0) {
      const clipCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(clipLibrary)
        .where(
          sql`lower(${clipLibrary.title}) LIKE ${"%" + keywords[0] + "%"}`
        )
        .then((rows) => Number(rows[0]?.count ?? 0));

      if (clipCount > 0) visualEvidence = 10;
    }
  } catch {
    // Visual check is best-effort
  }

  // 6. Moon relevance derived from the real Moon corpus.
  const moonResult = await scoreBoardStoryWithMoonCorpus(storyId);
  const moonRelevance = moonResult?.moonFitScore ?? 0;

  // Total — apply both Moon relevance AND age penalty
  // STRICT: if it's not Moon content, it should not score high regardless
  // of how many sources or how recent it is.
  // "Could Moon make a 10-20 min video about this?" — if no, crush the score.
  //
  // The corpus scorer gives 50-70 to almost everything because of generic
  // term overlap, so the thresholds need to be high.
  // Also check for hard disqualifiers from the corpus scorer.
  const hasDisqualifiers = (moonResult?.disqualifierCodes?.length ?? 0) > 0;
  const relevanceMultiplier = hasDisqualifiers ? 0.1
    : moonRelevance >= 70 ? 1.0
    : moonRelevance >= 55 ? 0.7
    : moonRelevance >= 40 ? 0.4
    : 0.08; // Low-fit content gets 8% — effectively killed

  const rawTotal =
    sourceScore +
    controversyScore +
    timelinessScore +
    competitorOverlap +
    visualEvidence;

  // Apply both multipliers: relevance × age
  const totalScore = Math.round(rawTotal * relevanceMultiplier * agePenaltyMultiplier);

  // Surge detection: items_count increased by 3+ in last hour
  let surgeActive = false;
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentItems = await db
      .select({ count: sql<number>`count(*)` })
      .from(boardStorySources)
      .innerJoin(boardFeedItems, eq(boardStorySources.feedItemId, boardFeedItems.id))
      .where(
        and(
          eq(boardStorySources.storyId, storyId),
          gte(boardFeedItems.ingestedAt, oneHourAgo)
        )
      )
      .then((rows) => Number(rows[0]?.count ?? 0));

    surgeActive = recentItems >= 3;

    // Surge override: if actively surging, cancel age penalty
    // Old story resurfacing = worth covering
    if (surgeActive && agePenaltyMultiplier < 1.0) {
      agePenaltyMultiplier = 0.9; // slight penalty but mostly restored
    }
  } catch {
    // Surge check is best-effort
  }

  // Recalculate total with surge override
  const finalScore = surgeActive && agePenaltyMultiplier < 1.0
    ? Math.round(rawTotal * relevanceMultiplier * 0.9)
    : totalScore;

  const breakdown: ScoreBreakdown = {
    sourceScore,
    controversyScore,
    timelinessScore,
    competitorOverlap,
    visualEvidence,
    moonRelevance,
  };

  // Persist score to story
  await db
    .update(boardStoryCandidates)
    .set({
      surgeScore: finalScore,
      scoreJson: {
        ...coerceScoreJson(story.scoreJson),
        ...breakdown,
        overall: finalScore,
        tier: getTier(finalScore),
        surgeActive,
        moonFitScore: moonResult?.moonFitScore ?? 0,
        moonFitBand: moonResult?.moonFitBand ?? "low",
        moonCluster: moonResult?.clusterLabel ?? null,
        coverageMode: moonResult?.coverageMode ?? null,
        analogTitles: moonResult?.analogs.map((analog) => analog.title) ?? [],
        reasonCodes: moonResult?.reasonCodes ?? [],
        lastScoredAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(boardStoryCandidates.id, storyId));

  return {
    totalScore: finalScore,
    breakdown,
    tier: getTier(finalScore),
    surgeActive,
  };
}
