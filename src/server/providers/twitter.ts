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

export interface TwitterPostResult {
  postUrl: string;
  username: string;
  displayName: string;
  text: string;
  postedAt: string | null;
  likeCount: number;
  retweetCount: number;
  viewCount: number;
}

function normalizeTwitterHandle(value: string) {
  return value.replace(/^@+/, "").trim();
}

function parseTwitterResults(outputText: string): TwitterVideoResult[] {
  try {
    // Find JSON array in the response
    const jsonMatch = outputText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item: Record<string, unknown>) =>
        item.postUrl || item.post_url || item.video_url || item.id
      )
      .map((item: Record<string, unknown>) => {
        // Handle xAI's format: author = "Name - @handle", content, video_url, timestamp
        let username = String(item.username ?? "");
        let displayName = String(item.displayName ?? item.display_name ?? "");
        const author = String(item.author ?? "");
        if (!username && author) {
          const handleMatch = author.match(/@(\w+)/);
          username = handleMatch ? handleMatch[1] : author;
          displayName = author.replace(/ - @\w+$/, "").trim();
        }

        const id = String(item.id ?? "");
        const postUrl = String(
          item.postUrl ?? item.post_url ??
          (id ? `https://x.com/${username}/status/${id}` : "")
        );

        return {
          postUrl,
          username,
          displayName: displayName || username,
          text: String(item.text ?? item.content ?? "").slice(0, 500),
          videoDescription: String(item.videoDescription ?? item.video_description ?? item.content ?? "").slice(0, 300),
          postedAt: String(item.postedAt ?? item.posted_at ?? item.timestamp ?? "") || null,
          likeCount: Number(item.likeCount ?? item.like_count ?? item.likes ?? 0),
          retweetCount: Number(item.retweetCount ?? item.retweet_count ?? item.retweets ?? 0),
          viewCount: Number(item.viewCount ?? item.view_count ?? item.views ?? 0),
        };
      });
  } catch {
    return [];
  }
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
    model: "grok-4-fast",
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

  // Extract text from the responses API format
  // The output array contains tool_call items and a final message item
  let outputText = data.output_text ?? "";
  if (!outputText) {
    for (const item of data.output ?? []) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === "output_text" && c.text) {
            outputText = c.text;
          }
        }
      }
    }
  }

  try {
    const results = parseTwitterResults(outputText).slice(0, input.maxResults ?? 8);

    return { results };
  } catch {
    return { results: [] };
  }
}

export async function searchTwitterAccountPosts(input: {
  accountHandle: string;
  queryTerms?: string[];
  temporalContext: string | null;
  maxResults?: number;
}): Promise<{ results: TwitterPostResult[] }> {
  const env = getEnv();
  const apiKey = env.XAI_API_KEY;

  if (!apiKey) {
    return { results: [] };
  }

  const handle = normalizeTwitterHandle(input.accountHandle);
  const queryTerms = (input.queryTerms ?? []).filter(Boolean).join(" ");
  const body: Record<string, unknown> = {
    model: "grok-4-fast",
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
        content:
          `You search X/Twitter for posts from a specific account and return ONLY a JSON array. ` +
          `Each result must have: postUrl, username, displayName, text, postedAt (ISO date or null), likeCount, retweetCount, viewCount. ` +
          `Return at most ${input.maxResults ?? 6} results and prefer the most relevant recent posts.`,
      },
      {
        role: "user",
        content:
          `Find recent posts from @${handle}${queryTerms ? ` related to: ${queryTerms}` : ""}. ` +
          "If there are no good matches, return an empty array.",
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
  let outputText = data.output_text ?? "";
  if (!outputText) {
    for (const item of data.output ?? []) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (content.type === "output_text" && content.text) {
            outputText = content.text;
          }
        }
      }
    }
  }

  const results = parseTwitterResults(outputText)
    .filter((result) => normalizeTwitterHandle(result.username) === handle)
    .slice(0, input.maxResults ?? 6)
    .map((result) => ({
      postUrl: result.postUrl,
      username: result.username,
      displayName: result.displayName,
      text: result.text,
      postedAt: result.postedAt,
      likeCount: result.likeCount,
      retweetCount: result.retweetCount,
      viewCount: result.viewCount,
    }));

  return { results };
}
