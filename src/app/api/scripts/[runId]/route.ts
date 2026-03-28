import { NextRequest, NextResponse } from "next/server";

import {
  getLatestEdit,
  getEditHistory,
  saveEdit,
  updateEditStatus,
  listFeedback,
  addFeedback,
  resolveFeedback,
  deleteFeedback,
} from "@/server/services/script-editorial";

type RouteContext = { params: Promise<{ runId: string }> };

// GET /api/scripts/[runId]?kind=agent
// Returns latest edit + all feedback for this run
export async function GET(request: NextRequest, context: RouteContext) {
  const { runId } = await context.params;
  const kind = request.nextUrl.searchParams.get("kind") ?? "agent";

  const [edit, feedback, editHistory] = await Promise.all([
    getLatestEdit(runId, kind),
    listFeedback(runId, kind),
    getEditHistory(runId, kind),
  ]);

  return NextResponse.json({ edit, feedback, editHistory });
}

// POST /api/scripts/[runId]
// Body: { action, kind, ...payload }
export async function POST(request: NextRequest, context: RouteContext) {
  const { runId } = await context.params;
  const body = await request.json();
  const kind = body.kind ?? "agent";
  const action = body.action;

  switch (action) {
    case "save_edit": {
      const edit = await saveEdit({
        runId,
        runKind: kind,
        editedTitle: body.editedTitle,
        editedScript: body.editedScript,
        editedDeck: body.editedDeck,
        editStatus: body.editStatus,
      });
      return NextResponse.json({ edit });
    }

    case "update_status": {
      const edit = await updateEditStatus(runId, kind, body.editStatus);
      if (!edit) {
        return NextResponse.json({ error: "No edit found" }, { status: 404 });
      }
      return NextResponse.json({ edit });
    }

    case "add_feedback": {
      if (!body.body?.trim()) {
        return NextResponse.json(
          { error: "Feedback body is required" },
          { status: 400 }
        );
      }
      const item = await addFeedback({
        runId,
        runKind: kind,
        anchor: body.anchor,
        body: body.body,
      });
      return NextResponse.json({ feedback: item });
    }

    case "resolve_feedback": {
      const ok = await resolveFeedback(body.feedbackId);
      return NextResponse.json({ ok });
    }

    case "delete_feedback": {
      const ok = await deleteFeedback(body.feedbackId);
      return NextResponse.json({ ok });
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
  }
}
