import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { clipLibrary, clipNotes } from "@/server/db/schema";

type Ctx = { params: Promise<{ clipId: string }> };

async function getClipOrNull(clipId: string) {
  const db = getDb();
  const [clip] = await db
    .select({ id: clipLibrary.id })
    .from(clipLibrary)
    .where(eq(clipLibrary.id, clipId))
    .limit(1);

  return clip ?? null;
}

export async function GET(_: Request, ctx: Ctx) {
  const { clipId } = await ctx.params;
  const clip = await getClipOrNull(clipId);
  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  const db = getDb();
  const notes = await db
    .select()
    .from(clipNotes)
    .where(eq(clipNotes.clipId, clipId))
    .orderBy(desc(clipNotes.createdAt));
  return NextResponse.json({ notes });
}

const createSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  timestampMs: z.number().int().min(0).optional(),
  color: z.string().optional(),
});

export async function POST(request: Request, ctx: Ctx) {
  const { clipId } = await ctx.params;
  const body = createSchema.parse(await request.json());
  const clip = await getClipOrNull(clipId);
  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  const db = getDb();

  const [note] = await db
    .insert(clipNotes)
    .values({
      clipId,
      text: body.text,
      timestampMs: body.timestampMs ?? null,
      color: body.color ?? "yellow",
    })
    .returning();

  return NextResponse.json({ note }, { status: 201 });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { clipId } = await ctx.params;
  const url = new URL(request.url);
  const noteId = url.searchParams.get("noteId");
  if (!noteId) return NextResponse.json({ error: "noteId required" }, { status: 400 });

  const clip = await getClipOrNull(clipId);
  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  const db = getDb();
  const [deleted] = await db
    .delete(clipNotes)
    .where(and(eq(clipNotes.id, noteId), eq(clipNotes.clipId, clipId)))
    .returning({ id: clipNotes.id });

  if (!deleted) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
