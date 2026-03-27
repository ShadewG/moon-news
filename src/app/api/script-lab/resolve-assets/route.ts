import { NextResponse } from "next/server";

import { getEnv } from "@/server/config/env";

/** POST: resolve visual assets for a script via the ideation backend */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      script_text: string;
      script_title?: string;
      context_notes?: string;
    };

    if (!body.script_text?.trim() || body.script_text.trim().length < 100) {
      return NextResponse.json(
        { error: "Script text is required (100+ characters)" },
        { status: 400 }
      );
    }

    const ideationUrl = getEnv().IDEATION_BACKEND_URL;

    // Call the ideation backend's resolve endpoint (can take 2-5 minutes)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000); // 5 min

    const res = await fetch(
      `${ideationUrl}/research/script-builder/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          script_text: body.script_text.trim(),
          script_title: body.script_title?.trim() || null,
          context_notes: body.context_notes?.trim() || null,
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => `Status ${res.status}`);
      return NextResponse.json(
        { error: `Asset resolver failed: ${errText}` },
        { status: res.status }
      );
    }

    const data = await res.json();

    // Save the report so it shows up in Studio
    if (data.scriptTitle) {
      const slug = data.scriptTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);

      fetch(`${ideationUrl}/research/script-reports/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      }).catch(() => {
        // Non-critical — continue even if save fails
      });
    }

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Asset resolution timed out (5 min limit)" },
        { status: 504 }
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to resolve assets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
