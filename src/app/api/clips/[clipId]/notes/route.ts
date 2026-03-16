import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { clipNotes } from "@/server/db/schema";

type Ctx = { params: Promise<{ clipId: string }> };

export async function GET(_: Request, ctx: Ctx) {
  const { clipId } = await ctx.params;
  const db = getDb();
  const notes = await db
    .select()
    .from(clipNotes)
    .where(eq(clipNotes.clipId, clipId))
    .orderBy(desc(clipNotes.createdAt));
  return NextResponse.json({ notes });
}

const createSchema = z.object({
  text: z.string().min(1),
  timestampMs: z.number().optional(),
  color: z.string().optional(),
});

export async function POST(request: Request, ctx: Ctx) {
  const { clipId } = await ctx.params;
  const body = createSchema.parse(await request.json());
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

  const db = getDb();
  await db.delete(clipNotes).where(eq(clipNotes.id, noteId));
  return NextResponse.json({ deleted: true });
}
