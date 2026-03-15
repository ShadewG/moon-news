import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ jobId: "stub" }, { status: 202 });
}
