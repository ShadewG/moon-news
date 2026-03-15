import { NextResponse } from "next/server";

import { bootstrapDemoProject } from "@/server/services/projects";

export async function POST() {
  const project = await bootstrapDemoProject();

  return NextResponse.json(project);
}
