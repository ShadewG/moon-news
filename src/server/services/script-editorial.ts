import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { scriptEdits, scriptFeedback } from "@/server/db/schema";

// ─── Types ───

export interface ScriptEdit {
  id: string;
  runId: string;
  runKind: string;
  editedTitle: string | null;
  editedScript: string | null;
  editedDeck: string | null;
  editStatus: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptFeedbackItem {
  id: string;
  runId: string;
  runKind: string;
  anchor: string | null;
  body: string;
  resolved: boolean;
  createdAt: string;
}

// ─── Edits ───

export async function getLatestEdit(
  runId: string,
  runKind: string
): Promise<ScriptEdit | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(scriptEdits)
    .where(and(eq(scriptEdits.runId, runId), eq(scriptEdits.runKind, runKind)))
    .orderBy(desc(scriptEdits.version))
    .limit(1);

  return row ? serializeEdit(row) : null;
}

export async function getEditHistory(
  runId: string,
  runKind: string
): Promise<ScriptEdit[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(scriptEdits)
    .where(and(eq(scriptEdits.runId, runId), eq(scriptEdits.runKind, runKind)))
    .orderBy(desc(scriptEdits.version));

  return rows.map(serializeEdit);
}

export async function saveEdit(input: {
  runId: string;
  runKind: string;
  editedTitle?: string | null;
  editedScript?: string | null;
  editedDeck?: string | null;
  editStatus?: string;
}): Promise<ScriptEdit> {
  const db = getDb();

  // Get current max version
  const existing = await getLatestEdit(input.runId, input.runKind);
  const nextVersion = existing ? existing.version + 1 : 1;

  const [row] = await db
    .insert(scriptEdits)
    .values({
      runId: input.runId,
      runKind: input.runKind,
      editedTitle: input.editedTitle ?? existing?.editedTitle ?? null,
      editedScript: input.editedScript ?? existing?.editedScript ?? null,
      editedDeck: input.editedDeck ?? existing?.editedDeck ?? null,
      editStatus: (input.editStatus ?? existing?.editStatus ?? "draft") as any,
      version: nextVersion,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return serializeEdit(row);
}

export async function updateEditStatus(
  runId: string,
  runKind: string,
  editStatus: string
): Promise<ScriptEdit | null> {
  const db = getDb();
  const latest = await getLatestEdit(runId, runKind);
  if (!latest) return null;

  const [row] = await db
    .update(scriptEdits)
    .set({ editStatus: editStatus as any, updatedAt: new Date() })
    .where(eq(scriptEdits.id, latest.id))
    .returning();

  return row ? serializeEdit(row) : null;
}

// ─── Feedback ───

export async function listFeedback(
  runId: string,
  runKind: string
): Promise<ScriptFeedbackItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(scriptFeedback)
    .where(
      and(
        eq(scriptFeedback.runId, runId),
        eq(scriptFeedback.runKind, runKind)
      )
    )
    .orderBy(desc(scriptFeedback.createdAt));

  return rows.map(serializeFeedback);
}

export async function addFeedback(input: {
  runId: string;
  runKind: string;
  anchor?: string | null;
  body: string;
}): Promise<ScriptFeedbackItem> {
  const db = getDb();
  const [row] = await db
    .insert(scriptFeedback)
    .values({
      runId: input.runId,
      runKind: input.runKind,
      anchor: input.anchor ?? null,
      body: input.body,
      createdAt: new Date(),
    })
    .returning();

  return serializeFeedback(row);
}

export async function resolveFeedback(feedbackId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .update(scriptFeedback)
    .set({ resolved: true })
    .where(eq(scriptFeedback.id, feedbackId))
    .returning();

  return Boolean(row);
}

export async function deleteFeedback(feedbackId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .delete(scriptFeedback)
    .where(eq(scriptFeedback.id, feedbackId))
    .returning();

  return Boolean(row);
}

// ─── Serializers ───

function serializeEdit(row: typeof scriptEdits.$inferSelect): ScriptEdit {
  return {
    id: row.id,
    runId: row.runId,
    runKind: row.runKind,
    editedTitle: row.editedTitle,
    editedScript: row.editedScript,
    editedDeck: row.editedDeck,
    editStatus: row.editStatus,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeFeedback(
  row: typeof scriptFeedback.$inferSelect
): ScriptFeedbackItem {
  return {
    id: row.id,
    runId: row.runId,
    runKind: row.runKind,
    anchor: row.anchor,
    body: row.body,
    resolved: row.resolved,
    createdAt: row.createdAt.toISOString(),
  };
}
