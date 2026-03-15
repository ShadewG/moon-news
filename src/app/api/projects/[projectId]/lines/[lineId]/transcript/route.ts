import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ job: null, transcript: null });
}
