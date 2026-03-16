import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { clipLibrary, transcriptCache } from "@/server/db/schema";
import { askAboutTranscript } from "@/server/providers/openai";

type Ctx = { params: Promise<{ clipId: string }> };

const askSchema = z.object({
  question: z.string().min(2).max(500),
});

export async function POST(request: Request, ctx: Ctx) {
  const { clipId } = await ctx.params;
  const { question } = askSchema.parse(await request.json());
  const db = getDb();

  const [clip] = await db.select().from(clipLibrary).where(eq(clipLibrary.id, clipId)).limit(1);
  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  const [transcript] = await db
    .select()
    .from(transcriptCache)
    .where(and(eq(transcriptCache.clipId, clipId), eq(transcriptCache.language, "en")))
    .limit(1);

  if (!transcript) {
    return NextResponse.json({
      answer: "No transcript available for this video. The transcript needs to be extracted first.",
      moments: [],
    });
  }

  const segments = transcript.segmentsJson as Array<{
    text: string;
    startMs: number;
    durationMs: number;
  }>;

  const result = await askAboutTranscript({
    question,
    transcript: segments,
    videoTitle: clip.title,
  });

  return NextResponse.json(result);
}
