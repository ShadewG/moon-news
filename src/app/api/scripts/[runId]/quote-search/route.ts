import { NextRequest, NextResponse } from "next/server";

import {
  listLibraryClips,
  getCachedTranscriptSegments,
} from "@/server/services/clip-library";
import { findRelevantQuotes } from "@/server/providers/openai";

type RouteContext = { params: Promise<{ runId: string }> };

// POST /api/scripts/[runId]/quote-search
// Body: { query, scriptContext? }
export async function POST(request: NextRequest, context: RouteContext) {
  const { runId: _runId } = await context.params;
  const body = await request.json();
  const { query, scriptContext } = body as {
    query: string;
    scriptContext?: string;
  };

  if (!query?.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    // Search library clips with transcript-only filter
    const listing = await listLibraryClips({
      q: query.trim(),
      transcriptOnly: true,
      sort: "quotes",
      limit: 10,
    });

    // For each clip with a transcript match, extract relevant quotes
    const results: Array<{
      clipId: string;
      clipTitle: string;
      sourceUrl: string;
      channelOrContributor: string | null;
      quotes: Array<{
        quoteText: string;
        speaker: string | null;
        startMs: number;
        endMs: number;
        relevanceScore: number;
        context: string;
      }>;
    }> = [];

    // Process top 5 clips with transcripts in parallel
    const clipsToProcess = listing.clips
      .filter((clip) => clip.hasTranscript)
      .slice(0, 5);

    const quoteResults = await Promise.allSettled(
      clipsToProcess.map(async (clip) => {
        const segments = await getCachedTranscriptSegments(clip.id);
        if (!segments || segments.length === 0) return null;

        const quotes = await findRelevantQuotes({
          lineText: query.trim(),
          transcript: segments,
          videoTitle: clip.title,
          maxQuotes: 3,
          scriptContext,
        });

        if (quotes.length === 0) return null;

        return {
          clipId: clip.id,
          clipTitle: clip.title,
          sourceUrl: clip.sourceUrl,
          channelOrContributor: clip.channelOrContributor,
          quotes,
        };
      })
    );

    for (const result of quoteResults) {
      if (result.status === "fulfilled" && result.value) {
        results.push(result.value);
      }
    }

    return NextResponse.json({
      results,
      totalClipsSearched: listing.clips.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quote search error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
