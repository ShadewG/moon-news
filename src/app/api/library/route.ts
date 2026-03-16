import { NextResponse } from "next/server";

import { searchLibrary } from "@/server/services/topic-search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";

  if (q.length < 2) {
    return NextResponse.json({ clips: [] });
  }

  const result = await searchLibrary(q);
  return NextResponse.json(result);
}
