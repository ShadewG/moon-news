import "server-only";

import { getEnv } from "@/server/config/env";

export interface TwitterVideoResult {
  postUrl: string;
  username: string;
  displayName: string;
  text: string;
  videoDescription: string;
  postedAt: string | null;
  likeCount: number;
  retweetCount: number;
  viewCount: number;
}

export async function searchTwitterVideos(input: {
  keywords: string[];
  temporalContext: string | null;
  maxResults?: number;
}): Promise<{ results: TwitterVideoResult[] }> {
  const env = getEnv();
  const apiKey = env.XAI_API_KEY;

  if (!apiKey) {
    return { results: [] };
  }

  const query = input.keywords.join(" ");

  const body: Record<string, unknown> = {
    model: "grok-3-fast",
    tools: [
      {
        type: "x_search",
        ...(input.temporalContext ? (() => {
          const yearMatch = input.temporalContext!.match(/\b(19|20)\d{2}\b/);
          return yearMatch ? { from_date: `${yearMatch[0]}-01-01` } : {};
        })() : {}),
      },
    ],
    input: [
      {
        role: "system",
        content: `You search X/Twitter for posts containing video clips relevant to documentary research. Return ONLY a JSON array of results. Each result must have: postUrl, username, displayName, text (post text), videoDescription (what the video shows), postedAt (ISO date or null), likeCount, retweetCount, viewCount (numbers, 0 if unknown). Return at most ${input.maxResults ?? 8} results. Prioritize posts with actual video content, high engagement, and from verified/notable accounts. Skip reposts without added context.`,
      },
      {
        role: "user",
        content: `Find X/Twitter posts with VIDEO content about: "${query}". These are for a documentary — I need real footage clips, news coverage, interviews, press conferences, or notable commentary. NOT memes or jokes.`,
      },
    ],
  };

  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`xAI API error: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();

  // Extract the text response — Grok returns the JSON array in output_text
  const outputText = data.output_text ?? data.choices?.[0]?.message?.content ?? "";

  try {
    // Find JSON array in the response
    const jsonMatch = outputText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { results: [] };

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return { results: [] };

    const results: TwitterVideoResult[] = parsed
      .filter((item: Record<string, unknown>) => item.postUrl || item.post_url)
      .map((item: Record<string, unknown>) => ({
        postUrl: String(item.postUrl ?? item.post_url ?? ""),
        username: String(item.username ?? ""),
        displayName: String(item.displayName ?? item.display_name ?? item.username ?? ""),
        text: String(item.text ?? "").slice(0, 500),
        videoDescription: String(item.videoDescription ?? item.video_description ?? ""),
        postedAt: String(item.postedAt ?? item.posted_at ?? "") || null,
        likeCount: Number(item.likeCount ?? item.like_count ?? 0),
        retweetCount: Number(item.retweetCount ?? item.retweet_count ?? 0),
        viewCount: Number(item.viewCount ?? item.view_count ?? 0),
      }))
      .slice(0, input.maxResults ?? 8);

    return { results };
  } catch {
    return { results: [] };
  }
}
