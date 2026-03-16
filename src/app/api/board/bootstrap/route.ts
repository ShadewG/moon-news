import { NextResponse } from "next/server";

import { getBoardBootstrapPayload } from "@/server/services/board";

export async function GET() {
  const payload = await getBoardBootstrapPayload();

  return NextResponse.json(payload);
}
