import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  boardCompetitorPosts,
  boardFeedItems,
  boardStoryCandidates,
  boardStorySources,
  clipLibrary,
  clipSearchResults,
} from "@/server/db/schema";
import { scoreMoonRelevance } from "./moon-relevance";

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

  // 3. Timeliness Score (20pts): based on age
  let timelinessScore = 5;
  if (story.lastSeenAt) {
    const ageMs = Date.now() - new Date(story.lastSeenAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours < 6) timelinessScore = 20;
    else if (ageHours < 24) timelinessScore = 15;
    else if (ageHours < 168) timelinessScore = 10; // 7 days
    else timelinessScore = 5;
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

  // 6. Moon Relevance with platform engagement signals
  const moonResult = scoreMoonRelevance(story.canonicalTitle, null, {
    sourceCount: sourceCount,
    controversyScore: story.controversyScore,
    sentimentMagnitude: Math.abs(story.sentimentScore),
    hasTwitterDiscourse: story.sourcesCount > 0, // TODO: check actual Twitter sources
    hasYouTubeContent: visualEvidence > 0,
    hasMultipleSources: sourceCount >= 3,
  });
  const moonRelevance = moonResult.combinedScore;

  // Update vertical to Moon's categories if we found a match
  if (moonResult.vertical) {
    await db
      .update(boardStoryCandidates)
      .set({ vertical: moonResult.vertical, updatedAt: new Date() })
      .where(eq(boardStoryCandidates.id, storyId));
  }

  // Total — Moon relevance acts as a multiplier
  // Irrelevant stories (moonRelevance < 15) get max score of 40
  // Highly relevant (moonRelevance > 60) get full score
  const relevanceMultiplier = moonRelevance >= 60 ? 1.0
    : moonRelevance >= 30 ? 0.7
    : moonRelevance >= 15 ? 0.5
    : 0.3;

  const rawTotal =
    sourceScore +
    controversyScore +
    timelinessScore +
    competitorOverlap +
    visualEvidence;

  const totalScore = Math.round(rawTotal * relevanceMultiplier);

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
  } catch {
    // Surge check is best-effort
  }

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
      surgeScore: totalScore,
      scoreJson: breakdown as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(boardStoryCandidates.id, storyId));

  return {
    totalScore,
    breakdown,
    tier: getTier(totalScore),
    surgeActive,
  };
}
