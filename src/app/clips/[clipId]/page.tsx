import { desc, eq, or } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  clipAiQueries,
  clipLibrary,
  clipNotes,
  clipSearchQuotes,
  scriptAgentQuotes,
  scriptAgentSources,
  transcriptCache,
} from "@/server/db/schema";
import ClipDetailClient from "./clip-detail-client";

type Props = {
  params: Promise<{ clipId: string }>;
  searchParams?: Promise<{ tab?: string }>;
};

function normalizeInitialTab(value: string | undefined): "quotes" | "transcript" | "notes" | "ask" | null {
  return value === "quotes" || value === "transcript" || value === "notes" || value === "ask"
    ? value
    : null;
}

export async function generateMetadata({ params }: Props) {
  const { clipId } = await params;
  try {
    const db = getDb();
    const [c] = await db.select().from(clipLibrary).where(eq(clipLibrary.id, clipId)).limit(1);
    return { title: c ? `${c.title.slice(0, 50)} — Clip` : "Clip Not Found" };
  } catch {
    return { title: "Clip Not Found" };
  }
}

export default async function ClipDetailPage({ params, searchParams }: Props) {
  const { clipId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const db = getDb();

  let clip;
  try {
    [clip] = await db.select().from(clipLibrary).where(eq(clipLibrary.id, clipId)).limit(1);
  } catch {
    // Invalid UUID format
  }
  if (!clip) {
    return (
      <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center gap-4">
        <div className="text-[#52525b] text-lg">Clip not found</div>
        <a href="/library" className="text-sm text-[#3b82f6] hover:underline">← Back to Library</a>
      </div>
    );
  }

  const [transcript, searchQuotes, scriptQuotes, notes, aiQueries] = await Promise.all([
    db.select().from(transcriptCache).where(eq(transcriptCache.clipId, clipId)).limit(1),
    db.select().from(clipSearchQuotes).where(eq(clipSearchQuotes.clipId, clipId)).orderBy(desc(clipSearchQuotes.relevanceScore)),
    db
      .select({
        quote: scriptAgentQuotes,
        source: scriptAgentSources,
      })
      .from(scriptAgentQuotes)
      .leftJoin(scriptAgentSources, eq(scriptAgentSources.id, scriptAgentQuotes.sourceId))
      .where(
        or(
          eq(scriptAgentSources.clipId, clipId),
          eq(scriptAgentQuotes.sourceUrl, clip.sourceUrl)
        )
      )
      .orderBy(desc(scriptAgentQuotes.relevanceScore), desc(scriptAgentQuotes.createdAt)),
    db.select().from(clipNotes).where(eq(clipNotes.clipId, clipId)).orderBy(desc(clipNotes.createdAt)),
    db.select().from(clipAiQueries).where(eq(clipAiQueries.clipId, clipId)).orderBy(desc(clipAiQueries.createdAt)).limit(12),
  ]);

  const allQuotes = [
    ...searchQuotes.map((q) => ({
      id: q.id,
      quoteText: q.quoteText,
      speaker: q.speaker,
      startMs: q.startMs,
      relevanceScore: q.relevanceScore,
      context: q.context,
      provenance: "topic-search" as const,
      sourceLabel: "Topic search",
    })),
    ...scriptQuotes.map(({ quote, source }) => ({
      id: quote.id,
      quoteText: quote.quoteText,
      speaker: quote.speaker,
      startMs: quote.startMs ?? 0,
      relevanceScore: quote.relevanceScore,
      context: quote.context,
      provenance: "script-agent" as const,
      sourceLabel: source?.title ?? quote.sourceLabel,
    })),
  ];

  const dedupedQuotes = new Map<string, (typeof allQuotes)[number]>();

  for (const quote of allQuotes) {
    const key = `${Math.max(0, quote.startMs)}|${quote.quoteText.trim().toLowerCase()}`;
    const existing = dedupedQuotes.get(key);
    if (!existing || quote.relevanceScore > existing.relevanceScore) {
      dedupedQuotes.set(key, quote);
    }
  }

  const combinedQuotes = Array.from(dedupedQuotes.values()).sort(
    (left, right) => right.relevanceScore - left.relevanceScore
  );

  const data = {
    clip: {
      id: clip.id,
      provider: clip.provider,
      externalId: clip.externalId,
      title: clip.title,
      sourceUrl: clip.sourceUrl,
      channelOrContributor: clip.channelOrContributor,
      durationMs: clip.durationMs,
      viewCount: clip.viewCount,
      uploadDate: clip.uploadDate,
    },
    transcript: transcript[0]
      ? (transcript[0].segmentsJson as Array<{ text: string; startMs: number; durationMs: number }>)
      : null,
    quotes: combinedQuotes,
    notes: notes.map((n) => ({
      id: n.id,
      text: n.text,
      timestampMs: n.timestampMs,
      color: n.color,
      createdAt: n.createdAt.toISOString(),
    })),
    aiHistory: aiQueries.map((entry) => ({
      id: entry.id,
      question: entry.question,
      response: {
        answer: entry.answer,
        moments: entry.momentsJson as Array<{
          text: string;
          startMs: number;
          timestamp: string;
        }>,
      },
      createdAt: entry.createdAt.toISOString(),
    })),
    initialTab: normalizeInitialTab(resolvedSearchParams?.tab),
  };

  return <ClipDetailClient data={data} />;
}
