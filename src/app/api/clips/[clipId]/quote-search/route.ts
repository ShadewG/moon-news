import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  findRelevantQuotes,
  scanTranscriptForMission,
} from "@/server/providers/openai";
import { getDb } from "@/server/db/client";
import { clipLibrary, clipSearches, clipSearchQuotes, transcriptCache } from "@/server/db/schema";

type Ctx = { params: Promise<{ clipId: string }> };

const quoteSearchSchema = z.object({
  query: z.string().trim().max(500).optional(),
  save: z.boolean().optional().default(false),
});

const DEFAULT_QUOTE_QUERY =
  "Find the strongest direct quotes, admissions, vivid lines, and sourceable moments from this video that a documentary writer would actually want to use.";

function buildFallbackQuotes(
  transcript: Array<{ text: string; startMs: number; durationMs: number }>,
  query: string
) {
  const trimmedQuery = query.trim().toLowerCase();
  const keywords = Array.from(
    new Set(
      trimmedQuery
        .split(/[^a-z0-9]+/i)
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length >= 3)
        .filter(
          (term) =>
            !["this", "that", "with", "from", "they", "them", "have", "what", "when", "where", "which", "into", "would"].includes(term)
        )
    )
  );

  const windows = transcript.map((segment, index) => {
    const slice = transcript.slice(index, index + 2);
    const text = slice.map((item) => item.text.trim()).join(" ").replace(/\s+/g, " ").trim();
    const end = slice[slice.length - 1];
    const words = text.split(/\s+/).filter(Boolean);
    const keywordHits = keywords.reduce(
      (count, term) => (text.toLowerCase().includes(term) ? count + 1 : count),
      0
    );
    const bannedIntro =
      /^(\[?music\]?|welcome back|thanks for watching|today we're|today we are|before we begin|let's get into it)/i.test(
        text
      );
    const score =
      (keywords.length > 0 ? keywordHits * 30 : 0) +
      Math.min(words.length, 38) +
      (/[.!?]$/.test(text) ? 8 : 0) +
      (/n't\b|never|always|real|fake|lie|truth|admit|because|but|if|when/i.test(text) ? 8 : 0) -
      (bannedIntro ? 25 : 0);

    return {
      quoteText: text,
      speaker: null,
      startMs: segment.startMs,
      endMs: end.startMs + (end.durationMs || 5000),
      relevanceScore: Math.max(0, Math.min(100, score)),
      context:
        keywords.length > 0
          ? `Fallback transcript match for: ${keywords.join(", ")}`
          : "Fallback transcript pull based on the strongest available lines.",
      keywordHits,
      wordCount: words.length,
    };
  });

  return Array.from(
    new Map(
      windows
        .filter((item) => item.wordCount >= 8)
        .filter((item) => (keywords.length > 0 ? item.keywordHits > 0 : item.relevanceScore >= 28))
        .sort((left, right) => right.relevanceScore - left.relevanceScore)
        .map((item) => [`${item.startMs}|${item.quoteText.toLowerCase().slice(0, 80)}`, item])
    ).values()
  )
    .slice(0, 8)
    .map(({ keywordHits: _keywordHits, wordCount: _wordCount, ...quote }) => quote);
}

export async function POST(request: Request, ctx: Ctx) {
  const { clipId } = await ctx.params;
  const { query, save } = quoteSearchSchema.parse(await request.json());
  const db = getDb();

  const [clip] = await db
    .select()
    .from(clipLibrary)
    .where(eq(clipLibrary.id, clipId))
    .limit(1);

  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  const [transcript] = await db
    .select()
    .from(transcriptCache)
    .where(
      and(
        eq(transcriptCache.clipId, clipId),
        eq(transcriptCache.language, "en")
      )
    )
    .limit(1);

  if (!transcript) {
    return NextResponse.json(
      { error: "No transcript available for this clip." },
      { status: 400 }
    );
  }

  const transcriptSegments = transcript.segmentsJson as Array<{
    text: string;
    startMs: number;
    durationMs: number;
  }>;
  const trimmedQuery = query?.trim() ?? "";

  let quotes = trimmedQuery
    ? await findRelevantQuotes({
        lineText: trimmedQuery,
        transcript: transcriptSegments,
        videoTitle: clip.title,
        maxQuotes: 8,
      })
    : (
        await scanTranscriptForMission({
          missionTitle: "Library quote pull",
          missionObjective:
            "Find the strongest direct quotes, admissions, vivid lines, and sourceable moments a documentary writer would want to reuse.",
          missionInstructions: [
            "Prefer quotable passages that stand alone cleanly.",
            "Favor admissions, precise claims, vivid explanations, and emotionally sharp phrasing.",
            "Skip filler, housekeeping, and weak setup.",
          ],
          transcript: transcriptSegments,
          videoTitle: clip.title,
          maxPointsPerChunk: 4,
        })
      ).talkingPoints
        .slice(0, 8)
        .map((point) => ({
          quoteText: point.quoteText,
          speaker: point.speaker,
          startMs: point.startMs,
          endMs: point.endMs,
          relevanceScore: point.relevanceScore,
          context: point.whyRelevant,
        }));

  if (quotes.length === 0) {
    quotes = buildFallbackQuotes(transcriptSegments, trimmedQuery);
  }

  // Persist quotes when save=true (from library generate button)
  if (save && quotes.length > 0) {
    try {
      const searchQuery = trimmedQuery || DEFAULT_QUOTE_QUERY;
      const [search] = await db
        .insert(clipSearches)
        .values({
          query: searchQuery,
          resultsCount: 1,
          quotesCount: quotes.length,
        })
        .returning({ id: clipSearches.id });

      if (search) {
        await db.insert(clipSearchQuotes).values(
          quotes.map((q) => ({
            searchId: search.id,
            clipId,
            quoteText: q.quoteText,
            speaker: q.speaker ?? null,
            startMs: q.startMs,
            endMs: q.endMs,
            relevanceScore: Math.round(q.relevanceScore),
            context: q.context ?? null,
          }))
        );
      }
    } catch {
      // Non-critical — quotes are still returned even if save fails
    }
  }

  return NextResponse.json({
    query: trimmedQuery || DEFAULT_QUOTE_QUERY,
    quotes,
  });
}
