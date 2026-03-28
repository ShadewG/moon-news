import { NextRequest, NextResponse } from "next/server";

import { scriptAssistant } from "@/server/providers/openai";

type RouteContext = { params: Promise<{ runId: string }> };

// POST /api/scripts/[runId]/assistant
// Body: { instruction, selectedText?, fullScript, researchContext?, conversationHistory? }
export async function POST(request: NextRequest, context: RouteContext) {
  const { runId: _runId } = await context.params;
  const body = await request.json();

  const { instruction, selectedText, fullScript, researchContext, conversationHistory } = body as {
    instruction: string;
    selectedText?: string | null;
    fullScript: string;
    researchContext?: string | null;
    conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!instruction?.trim()) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }

  try {
    const result = await scriptAssistant({
      instruction: instruction.trim(),
      selectedText: selectedText ?? null,
      fullScript: fullScript ?? "",
      researchContext: researchContext ?? null,
      conversationHistory,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI assistant error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
