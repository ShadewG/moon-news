import "server-only";

import { getEnv } from "@/server/config/env";
import { fetchBoardRssItems } from "@/server/services/board/rss";

export interface TwitterVideoResult {
  postUrl: string;
  username: string;
  displayName: string;
  text: string;
  videoDescription: string;
  hasVideo: boolean;
  tweetId: string | null;
  thumbnailUrl: string | null;
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
  videoDescription: string | null;
  hasVideo: boolean;
  tweetId: string | null;
  thumbnailUrl: string | null;
  postedAt: string | null;
  likeCount: number;
  retweetCount: number;
  viewCount: number;
}

function normalizeTwitterHandle(value: string) {
  return value.replace(/^@+/, "").trim();
}

function parseAbbreviatedCount(value: string) {
  const normalized = value.trim().toLowerCase().replace(/,/g, "");
  const match = normalized.match(/^(\d+(?:\.\d+)?)([kmb])?\+?$/);
  if (!match) {
    return 0;
  }
  const base = Number(match[1] ?? "0");
  const suffix = match[2] ?? "";
  const multiplier =
    suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1;
  return Math.round(base * multiplier);
}

function extractTweetIdFromUrl(url: string) {
  const match = url.match(/\/status\/(\d+)/i);
  return match?.[1] ?? null;
}

function buildXSearchToolConfig(input: {
  temporalContext: string | null;
  allowedHandles?: string[];
  excludedHandles?: string[];
  enableImageUnderstanding?: boolean;
  enableVideoUnderstanding?: boolean;
}) {
  const tool: Record<string, unknown> = {
    type: "x_search",
  };

  if (input.temporalContext) {
    const yearMatch = input.temporalContext.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      tool.from_date = `${yearMatch[0]}-01-01`;
    }
  }

  if (input.allowedHandles && input.allowedHandles.length > 0) {
    tool.allowed_x_handles = input.allowedHandles.slice(0, 10).map(normalizeTwitterHandle);
  }

  if (input.excludedHandles && input.excludedHandles.length > 0) {
    tool.excluded_x_handles = input.excludedHandles.slice(0, 10).map(normalizeTwitterHandle);
  }

  if (input.enableImageUnderstanding) {
    tool.enable_image_understanding = true;
  }

  if (input.enableVideoUnderstanding) {
    tool.enable_video_understanding = true;
  }

  return tool;
}

function parseTwitterResults(outputText: string): TwitterVideoResult[] {
  try {
    // Find JSON array in the response
    const jsonMatch = outputText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
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
            const normalizedVideoDescription = String(
              item.videoDescription ?? item.video_description ?? ""
            ).slice(0, 300);
            const tweetId = id || extractTweetIdFromUrl(postUrl);
            const hasVideo =
              item.hasVideo === true ||
              item.has_video === true ||
              Boolean(item.video_url || item.videoUrl) ||
              normalizedVideoDescription.length > 0;

            return {
              postUrl,
              username,
              displayName: displayName || username,
              text: String(item.text ?? item.content ?? "").slice(0, 500),
              videoDescription: normalizedVideoDescription,
              hasVideo,
              tweetId,
              thumbnailUrl:
                typeof item.thumbnailUrl === "string"
                  ? item.thumbnailUrl
                  : typeof item.thumbnail_url === "string"
                    ? item.thumbnail_url
                    : null,
              postedAt: String(item.postedAt ?? item.posted_at ?? item.timestamp ?? "") || null,
              likeCount: Number(item.likeCount ?? item.like_count ?? item.likes ?? 0),
              retweetCount: Number(item.retweetCount ?? item.retweet_count ?? item.retweets ?? 0),
              viewCount: Number(item.viewCount ?? item.view_count ?? item.views ?? 0),
            };
          });
      }
    }
  } catch {
    // Fall through to markdown parsing below.
  }

  const bulletBlocks = outputText
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => /^\*\*-\s*@/m.test(block) || /^-\s*@/m.test(block));

  const parsedBullets = bulletBlocks
    .map<TwitterVideoResult | null>((block) => {
      const line = block.replace(/<br\s*\/?>/gi, "\n").split("\n")[0]?.trim() ?? block;
      const handleMatch = line.match(/@([A-Za-z0-9_]+)/);
      const urlMatch = block.match(/\(https:\/\/x\.com\/[^)\s]+\)/i);
      const idUrlMatch = block.match(/https:\/\/x\.com\/[^)\s]+/i);
      const dateMatch = block.match(/\((?:[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
      const viewsMatch = block.match(/(\d+(?:\.\d+)?[KMB]?\+?)\s+views/i);

      if (!handleMatch || !idUrlMatch) {
        return null;
      }

      const username = handleMatch[1] ?? "";
      const displayMatch = line.match(/^\*?\*?-?\s*@?[A-Za-z0-9_]+\s*\(([^)]+)\)/);
      const description = block
        .replace(line, "")
        .replace(/\[\[\d+\]\]\(https:\/\/x\.com\/[^)]+\)/gi, "")
        .replace(/^\s*[-*]\s*/gm, "")
        .replace(/\s+/g, " ")
        .trim();

      return {
        postUrl: idUrlMatch[0],
        username,
        displayName: (displayMatch?.[1] ?? username).trim(),
        text: description.slice(0, 500),
        videoDescription: description.slice(0, 300),
        hasVideo: /video|clip|watch|footage/i.test(description),
        tweetId: extractTweetIdFromUrl(idUrlMatch[0]),
        thumbnailUrl: null,
        postedAt: dateMatch ? new Date(dateMatch[0].slice(1)).toISOString() : null,
        likeCount: 0,
        retweetCount: 0,
        viewCount: viewsMatch ? parseAbbreviatedCount(viewsMatch[1] ?? "0") : 0,
      } satisfies TwitterVideoResult;
    })
    .filter((item): item is TwitterVideoResult => Boolean(item));

  return parsedBullets;
}

const NITTER_RSS_BASE_URLS = ["https://nitter.net"];

function normalizeTwitterPostUrl(url: string, username: string) {
  const normalizedUsername = normalizeTwitterHandle(username);
  return url
    .replace(/^https:\/\/nitter\.net\//i, "https://x.com/")
    .replace(/^https:\/\/twitter\.com\//i, "https://x.com/")
    .replace(/#m$/i, "")
    .replace(
      /^https:\/\/x\.com\/([^/]+)\/status\/(\d+)$/i,
      (_match, handle, id) => `https://x.com/${normalizeTwitterHandle(handle || normalizedUsername)}/status/${id}`
    );
}

function countQueryTermHits(text: string, queryTerms: string[]) {
  const haystack = text.toLowerCase();
  return queryTerms.reduce((count, queryTerm) => {
    const normalizedTerm = queryTerm.trim().toLowerCase();
    if (!normalizedTerm) {
      return count;
    }

    return haystack.includes(normalizedTerm) ? count + 1 : count;
  }, 0);
}

async function fetchTwitterAccountPostsFromNitterRss(input: {
  accountHandle: string;
  queryTerms?: string[];
  maxResults?: number;
}): Promise<{ results: TwitterPostResult[] }> {
  const handle = normalizeTwitterHandle(input.accountHandle);
  const normalizedTerms = (input.queryTerms ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length > 0);

  for (const baseUrl of NITTER_RSS_BASE_URLS) {
    try {
      const items = await fetchBoardRssItems(`${baseUrl}/${handle}/rss`);
      const results = items
        .map((item) => {
          const text = (item.summary ?? item.title).trim();
          const normalizedText = text.replace(/\s+/g, " ").trim();
          const hasVideo = /\b(video|clip|footage)\b/i.test(normalizedText);
          return {
            postUrl: normalizeTwitterPostUrl(item.url, handle),
            username: handle,
            displayName: (item.author ?? `@${handle}`).replace(/^@+/, ""),
            text: normalizedText.slice(0, 500),
            videoDescription: hasVideo ? normalizedText.slice(0, 300) : null,
            hasVideo,
            tweetId: extractTweetIdFromUrl(item.url),
            thumbnailUrl: null,
            postedAt: item.publishedAt?.toISOString() ?? null,
            likeCount: 0,
            retweetCount: 0,
            viewCount: 0,
          } satisfies TwitterPostResult;
        })
        .sort((left, right) => {
          const leftScore = countQueryTermHits(left.text, normalizedTerms);
          const rightScore = countQueryTermHits(right.text, normalizedTerms);
          if (rightScore !== leftScore) {
            return rightScore - leftScore;
          }

          const leftTime = left.postedAt ? Date.parse(left.postedAt) : 0;
          const rightTime = right.postedAt ? Date.parse(right.postedAt) : 0;
          return rightTime - leftTime;
        })
        .slice(0, input.maxResults ?? 6);

      return { results };
    } catch {
      // Try the next Nitter base URL.
    }
  }

  return { results: [] };
}

export async function searchTwitterVideos(input: {
  keywords: string[];
  temporalContext: string | null;
  maxResults?: number;
}): Promise<{ results: TwitterVideoResult[] }> {
  const env = getEnv();
  const apiKey = env.XAI_API_KEY;

  if (!env.ENABLE_X_SEARCH || !apiKey) {
    return { results: [] };
  }

  const query = input.keywords.join(" ");

  const body: Record<string, unknown> = {
    model: env.XAI_SEARCH_MODEL,
    store: false,
    tools: [
      buildXSearchToolConfig({
        temporalContext: input.temporalContext,
        enableVideoUnderstanding: true,
      }),
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

export async function searchTwitterPosts(input: {
  query: string;
  temporalContext: string | null;
  maxResults?: number;
  excludedHandles?: string[];
  allowedHandles?: string[];
  requireVideo?: boolean;
}): Promise<{ results: TwitterPostResult[] }> {
  const env = getEnv();
  const apiKey = env.XAI_API_KEY;

  if (!env.ENABLE_X_SEARCH || !apiKey) {
    return { results: [] };
  }

  const body: Record<string, unknown> = {
    model: env.XAI_SEARCH_MODEL,
    store: false,
    tools: [
      buildXSearchToolConfig({
        temporalContext: input.temporalContext,
        allowedHandles: input.allowedHandles,
        excludedHandles: input.excludedHandles,
        enableVideoUnderstanding: Boolean(input.requireVideo),
      }),
    ],
    input: [
      {
        role: "system",
        content:
          `You search X/Twitter for documentary research and return ONLY a JSON array. ` +
          `Each result must have: postUrl, username, displayName, text, hasVideo (boolean), videoDescription (string, empty if none), postedAt (ISO date or null), likeCount, retweetCount, viewCount. ` +
          `Return at most ${input.maxResults ?? 6} results. Prefer original posts, threads, quote tweets with added reporting, verified/notable accounts, and culturally important receipts. ` +
          `${input.requireVideo ? "Prefer posts with attached video and skip text-only posts when possible. " : ""}` +
          `Avoid repost-only junk, spam, and low-signal meme accounts.`,
      },
      {
        role: "user",
        content:
          `Find the strongest X/Twitter posts about: "${input.query}". ` +
          `These are for documentary research, so prioritize original receipts, eyewitness posts, journalists, creators, official statements, backlash, and notable public reaction. ` +
          `${input.requireVideo ? "Prioritize posts with attached video. " : ""}` +
          "If nothing useful exists, return an empty array.",
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
    .slice(0, input.maxResults ?? 6)
    .map((result) => ({
      postUrl: result.postUrl,
      username: result.username,
      displayName: result.displayName,
      text: result.text,
      videoDescription: result.videoDescription,
      hasVideo: result.hasVideo,
      tweetId: result.tweetId,
      thumbnailUrl: result.thumbnailUrl,
      postedAt: result.postedAt,
      likeCount: result.likeCount,
      retweetCount: result.retweetCount,
      viewCount: result.viewCount,
    }));

  return { results };
}

export async function searchTwitterAccountPosts(input: {
  accountHandle: string;
  queryTerms?: string[];
  temporalContext: string | null;
  maxResults?: number;
}): Promise<{ results: TwitterPostResult[] }> {
  const env = getEnv();
  const apiKey = env.XAI_API_KEY;

  if (!env.ENABLE_X_SEARCH) {
    return { results: [] };
  }

  if (!apiKey) {
    return fetchTwitterAccountPostsFromNitterRss(input);
  }

  const handle = normalizeTwitterHandle(input.accountHandle);
  const queryTerms = (input.queryTerms ?? []).filter(Boolean).join(" ");
  const body: Record<string, unknown> = {
    model: env.XAI_SEARCH_MODEL,
    tools: [
      buildXSearchToolConfig({
        temporalContext: input.temporalContext,
        allowedHandles: [handle],
      }),
    ],
    input: [
      {
        role: "system",
        content:
          `You search X/Twitter for posts from a specific account and return ONLY a JSON array. ` +
          `Each result must have: postUrl, username, displayName, text, hasVideo (boolean), videoDescription (string, empty if none), postedAt (ISO date or null), likeCount, retweetCount, viewCount. ` +
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

  try {
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
      if (response.status === 429 || response.status >= 500 || response.status === 403) {
        return fetchTwitterAccountPostsFromNitterRss(input);
      }

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
        videoDescription: result.videoDescription,
        hasVideo: result.hasVideo,
        tweetId: result.tweetId,
        thumbnailUrl: result.thumbnailUrl,
        postedAt: result.postedAt,
        likeCount: result.likeCount,
        retweetCount: result.retweetCount,
        viewCount: result.viewCount,
      }));

    return { results };
  } catch {
    return fetchTwitterAccountPostsFromNitterRss(input);
  }
}
