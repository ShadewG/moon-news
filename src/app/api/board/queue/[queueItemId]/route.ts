import { NextResponse } from "next/server";
import { z } from "zod";

import { boardQueueStatusEnum } from "@/server/db/schema";
import { updateBoardQueueItem } from "@/server/services/board";

const updateQueueSchema = z.object({
  position: z.number().int().positive().optional(),
  status: z.enum(boardQueueStatusEnum.enumValues).optional(),
  format: z.string().trim().min(1).max(120).nullable().optional(),
  assignedTo: z.string().trim().min(1).max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  targetPublishAt: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional(),
});

type RouteContext = {
  params: Promise<{
    queueItemId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { queueItemId } = await context.params;
  const payload = updateQueueSchema.parse(await request.json());
  const queueItem = await updateBoardQueueItem(queueItemId, {
    position: payload.position,
    status: payload.status,
    format: payload.format,
    assignedTo: payload.assignedTo,
    notes: payload.notes,
    targetPublishAt:
      payload.targetPublishAt === undefined
        ? undefined
        : payload.targetPublishAt
          ? new Date(payload.targetPublishAt)
          : null,
  });

  if (!queueItem) {
    return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
  }

  return NextResponse.json({ queueItem });
}
