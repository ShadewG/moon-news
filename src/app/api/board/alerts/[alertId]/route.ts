import { NextResponse } from "next/server";

import { dismissBoardAlert } from "@/server/services/board";

type RouteContext = {
  params: Promise<{
    alertId: string;
  }>;
};

export async function PATCH(_: Request, context: RouteContext) {
  const { alertId } = await context.params;
  const alert = await dismissBoardAlert(alertId);

  if (!alert) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  return NextResponse.json({ alert });
}
