import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  boardQueueItems,
  boardStoryCandidates,
} from "@/server/db/schema";

// ─── Queue Queries ───

export async function getQueue() {
  const db = getDb();

  return db
    .select({
      queueItem: boardQueueItems,
      story: boardStoryCandidates,
    })
    .from(boardQueueItems)
    .innerJoin(
      boardStoryCandidates,
      eq(boardStoryCandidates.id, boardQueueItems.storyId)
    )
    .orderBy(asc(boardQueueItems.position));
}

// ─── Queue Mutations ───

export async function addToQueue(
  storyId: string,
  format?: string
): Promise<string> {
  const db = getDb();

  // Get the next position (max + 1)
  const [maxPos] = await db
    .select({
      maxPosition: sql<number>`COALESCE(MAX(${boardQueueItems.position}), 0)::int`,
    })
    .from(boardQueueItems);

  const nextPosition = (maxPos?.maxPosition ?? 0) + 1;

  const [item] = await db
    .insert(boardQueueItems)
    .values({
      storyId,
      position: nextPosition,
      format: format ?? null,
      status: "watching",
    })
    .onConflictDoUpdate({
      target: [boardQueueItems.storyId],
      set: {
        format: format ?? sql`${boardQueueItems.format}`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: boardQueueItems.id });

  // Also update the story status to "queued"
  await db
    .update(boardStoryCandidates)
    .set({
      status: "queued",
      updatedAt: new Date(),
    })
    .where(eq(boardStoryCandidates.id, storyId));

  return item.id;
}

export async function updateQueueItem(
  id: string,
  updates: {
    status?: "watching" | "researching" | "scripting" | "filming" | "editing" | "published";
    assignedTo?: string | null;
    targetDate?: Date | null;
    notes?: string | null;
    format?: string | null;
  }
) {
  const db = getDb();

  const setClause: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (updates.status !== undefined) setClause.status = updates.status;
  if (updates.assignedTo !== undefined) setClause.assignedTo = updates.assignedTo;
  if (updates.targetDate !== undefined) setClause.targetPublishAt = updates.targetDate;
  if (updates.notes !== undefined) setClause.notes = updates.notes;
  if (updates.format !== undefined) setClause.format = updates.format;

  await db
    .update(boardQueueItems)
    .set(setClause)
    .where(eq(boardQueueItems.id, id));
}

export async function reorderQueue(
  itemId: string,
  newPosition: number
): Promise<void> {
  const db = getDb();

  // Get the current item
  const [item] = await db
    .select()
    .from(boardQueueItems)
    .where(eq(boardQueueItems.id, itemId))
    .limit(1);

  if (!item) {
    throw new Error(`Queue item not found: ${itemId}`);
  }

  const oldPosition = item.position;

  if (oldPosition === newPosition) return;

  if (newPosition < oldPosition) {
    // Moving up: shift items in [newPosition, oldPosition) down by 1
    await db
      .update(boardQueueItems)
      .set({
        position: sql`${boardQueueItems.position} + 1`,
        updatedAt: new Date(),
      })
      .where(
        sql`${boardQueueItems.position} >= ${newPosition} AND ${boardQueueItems.position} < ${oldPosition} AND ${boardQueueItems.id} != ${itemId}`
      );
  } else {
    // Moving down: shift items in (oldPosition, newPosition] up by 1
    await db
      .update(boardQueueItems)
      .set({
        position: sql`${boardQueueItems.position} - 1`,
        updatedAt: new Date(),
      })
      .where(
        sql`${boardQueueItems.position} > ${oldPosition} AND ${boardQueueItems.position} <= ${newPosition} AND ${boardQueueItems.id} != ${itemId}`
      );
  }

  // Set the item's new position
  await db
    .update(boardQueueItems)
    .set({
      position: newPosition,
      updatedAt: new Date(),
    })
    .where(eq(boardQueueItems.id, itemId));
}
