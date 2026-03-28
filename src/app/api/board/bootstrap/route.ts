import { NextResponse } from "next/server";

import { getBoardBootstrapPayload } from "@/server/services/board";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getBoardBootstrapPayload();

  return NextResponse.json(payload);
}
