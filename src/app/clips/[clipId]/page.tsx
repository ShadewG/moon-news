import { eq, desc } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  clipAiQueries,
  clipLibrary,
  clipNotes,
  clipSearchQuotes,
  transcriptCache,
} from "@/server/db/schema";
import ClipDetailClient from "./clip-detail-client";

type Props = { params: Promise<{ clipId: string }> };

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

export default async function ClipDetailPage({ params }: Props) {
  const { clipId } = await params;
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

  const [transcript, quotes, notes, aiQueries] = await Promise.all([
    db.select().from(transcriptCache).where(eq(transcriptCache.clipId, clipId)).limit(1),
    db.select().from(clipSearchQuotes).where(eq(clipSearchQuotes.clipId, clipId)).orderBy(desc(clipSearchQuotes.relevanceScore)),
    db.select().from(clipNotes).where(eq(clipNotes.clipId, clipId)).orderBy(desc(clipNotes.createdAt)),
    db.select().from(clipAiQueries).where(eq(clipAiQueries.clipId, clipId)).orderBy(desc(clipAiQueries.createdAt)).limit(12),
  ]);

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
    quotes: quotes.map((q) => ({
      id: q.id,
      quoteText: q.quoteText,
      speaker: q.speaker,
      startMs: q.startMs,
      relevanceScore: q.relevanceScore,
      context: q.context,
    })),
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
  };

  return <ClipDetailClient data={data} />;
}
