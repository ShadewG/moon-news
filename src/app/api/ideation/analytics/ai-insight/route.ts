import { NextResponse } from "next/server";

import { getEnv } from "@/server/config/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, views, avgRetention, likes, comments, shares, netSubs, duration, channelAvgViews, performance, topComments, deepAnalysis } = body;
    const apiKey = getEnv().ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Anthropic API key not configured" }, { status: 500 });

    let prompt: string;
    let maxTokens: number;

    if (deepAnalysis) {
      maxTokens = 1200;
      prompt = `You are a senior YouTube channel analyst for Moon, a documentary-style channel with 1.6M subscribers. Provide a comprehensive deep analysis of this video.

VIDEO: "${title}"
Views: ${views?.toLocaleString() ?? "unknown"} (channel avg: ${channelAvgViews?.toLocaleString() ?? "unknown"}, ${performance} average)
Retention: ${avgRetention ? avgRetention.toFixed(1) + "%" : "unknown"}
Duration: ${duration ? Math.floor(duration / 60) + "m" : "unknown"}
Likes: ${likes?.toLocaleString() ?? "unknown"}, Comments: ${comments?.toLocaleString() ?? "unknown"}, Shares: ${shares?.toLocaleString() ?? "unknown"}, Net subs: ${netSubs?.toLocaleString() ?? "unknown"}
${topComments?.length > 0 ? `Top comments:\n${topComments.slice(0, 8).map((c: string) => `- "${c.slice(0, 150)}"`).join("\n")}` : ""}

Provide your analysis in EXACTLY these sections with these exact headings:

## Summary
2-3 sentences covering overall performance and key takeaway.

## What Worked
3-4 bullet points on what drove success (topic choice, title/thumbnail appeal, retention patterns, shareability, etc.). Be specific with numbers.

## What Didn't Work
2-3 bullet points on weaknesses or missed opportunities. If the video performed well, focus on what could make the NEXT video even better.

## Audience Reaction
Analyze the comment sentiment. What themes appear? What are viewers responding to most? If no comments provided, analyze what the like/comment ratio suggests.

## Recommendation
2-3 specific, actionable recommendations for the next video on a similar topic. Be concrete — not generic advice.`;
    } else {
      maxTokens = 500;
      prompt = `You are a YouTube channel analyst for Moon, a documentary-style channel with 1.6M subscribers. Analyze this video briefly.

VIDEO: "${title}"
Views: ${views?.toLocaleString() ?? "unknown"} (channel avg: ${channelAvgViews?.toLocaleString() ?? "unknown"}, ${performance} average)
Retention: ${avgRetention ? avgRetention.toFixed(1) + "%" : "unknown"}
Duration: ${duration ? Math.floor(duration / 60) + "m" : "unknown"}
Likes: ${likes?.toLocaleString() ?? "unknown"}, Comments: ${comments?.toLocaleString() ?? "unknown"}, Shares: ${shares?.toLocaleString() ?? "unknown"}, Net subs: ${netSubs?.toLocaleString() ?? "unknown"}
${topComments?.length > 0 ? `Top comments: ${topComments.slice(0, 3).map((c: string) => `"${c.slice(0, 80)}"`).join("; ")}` : ""}

Give 3-4 bullet insights (1-2 sentences each). Be specific with numbers.`;
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `API error: ${err.slice(0, 200)}` }, { status: 500 });
    }

    const data = await res.json();
    const textBlock = data.content?.find((b: any) => b.type === "text");
    return NextResponse.json({ insight: textBlock?.text ?? "No insight generated" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
