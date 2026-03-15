import { NextResponse } from "next/server";

import { dismissRecommendation } from "@/server/services/investigation";

type RouteContext = {
  params: Promise<{
    projectId: string;
    lineId: string;
    recId: string;
  }>;
};

export async function PATCH(_: Request, context: RouteContext) {
  const { recId } = await context.params;

  const updated = await dismissRecommendation(recId);
  if (!updated) {
    return NextResponse.json(
      { error: "Recommendation not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ recommendation: updated });
}
