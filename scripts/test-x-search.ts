import { getEnv } from "@/server/config/env";

interface RawXSearchResult {
  postUrl?: string;
  post_url?: string;
  video_url?: string;
  username?: string;
  displayName?: string;
  display_name?: string;
  author?: string;
  text?: string;
  content?: string;
  videoDescription?: string;
  video_description?: string;
  postedAt?: string;
  posted_at?: string;
  timestamp?: string;
  likeCount?: number;
  like_count?: number;
  likes?: number;
  retweetCount?: number;
  retweet_count?: number;
  retweets?: number;
  viewCount?: number;
  view_count?: number;
  views?: number;
}

function parseResults(outputText: string) {
  const jsonMatch = outputText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return [];
  }

  const parsed = JSON.parse(jsonMatch[0]) as RawXSearchResult[];
  return parsed.slice(0, 5).map((item) => ({
    postUrl: item.postUrl ?? item.post_url ?? item.video_url ?? null,
    username: item.username ?? null,
    displayName: item.displayName ?? item.display_name ?? item.author ?? null,
    text: (item.text ?? item.content ?? "").slice(0, 180),
    videoDescription: (item.videoDescription ?? item.video_description ?? "").slice(0, 180),
    postedAt: item.postedAt ?? item.posted_at ?? item.timestamp ?? null,
    likeCount: item.likeCount ?? item.like_count ?? item.likes ?? 0,
    retweetCount: item.retweetCount ?? item.retweet_count ?? item.retweets ?? 0,
    viewCount: item.viewCount ?? item.view_count ?? item.views ?? 0,
  }));
}

async function main() {
  const env = getEnv();
  const query = process.argv.slice(2).join(" ").trim();

  if (!query) {
    throw new Error("Usage: tsx scripts/test-x-search.ts \"query\"");
  }

  if (!env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is required");
  }

  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.XAI_SEARCH_MODEL,
      tools: [{ type: "x_search" }],
      input: [
        {
          role: "system",
          content:
            "You search X/Twitter for documentary research and return ONLY a JSON array with postUrl, username, displayName, text, videoDescription, postedAt, likeCount, retweetCount, viewCount.",
        },
        {
          role: "user",
          content:
            `Find up to 5 X/Twitter posts with VIDEO content about: "${query}". ` +
            "Prefer primary footage, news clips, interviews, and notable commentary. No memes.",
        },
      ],
    }),
  });

  const text = await response.text();
  let json: Record<string, unknown> | null = null;

  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }

  const outputText =
    (json && typeof json.output_text === "string" ? json.output_text : "") ||
    "";

  console.log(
    JSON.stringify(
      {
        status: response.status,
        model: env.XAI_SEARCH_MODEL,
        usage: json && typeof json.usage === "object" ? json.usage : null,
        resultsPreview: outputText ? parseResults(outputText) : [],
        rawOutputPreview: outputText.slice(0, 800),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
