import "server-only";

import { getEnv } from "@/server/config/env";

// ─── Types ───

export interface NewsSearchResult {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt: string | null;
}

type SearchMode = "quick" | "full";

// ─── URL normalization for deduplication ───

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase();
    // Strip tracking params
    const trackingPrefixes = ["utm_", "ref", "fbclid", "gclid", "mc_"];
    for (const key of [...u.searchParams.keys()]) {
      if (trackingPrefixes.some((p) => key.startsWith(p))) {
        u.searchParams.delete(key);
      }
    }
    // Remove trailing slash
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return raw;
  }
}

function deduplicateResults(
  results: NewsSearchResult[]
): NewsSearchResult[] {
  const seen = new Set<string>();
  const deduped: NewsSearchResult[] = [];

  for (const r of results) {
    const normalized = normalizeUrl(r.url);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      deduped.push(r);
    }
  }

  return deduped;
}

// ─── Serper (Google Search API) ───

async function searchSerper(query: string): Promise<NewsSearchResult[]> {
  const apiKey = getEnv().SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({ q: query, num: 10 }),
    });

    if (!res.ok) {
      console.error(`[news-search] Serper returned ${res.status}`);
      return [];
    }

    const data = (await res.json()) as {
      organic?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
        date?: string;
      }>;
    };

    return (data.organic ?? []).map((item) => ({
      title: item.title ?? "",
      url: item.link ?? "",
      source: "serper",
      snippet: item.snippet ?? "",
      publishedAt: item.date ?? null,
    }));
  } catch (err) {
    console.error("[news-search] Serper error:", err);
    return [];
  }
}

// ─── Perplexity Sonar ───

async function searchPerplexity(
  query: string
): Promise<NewsSearchResult[]> {
  const apiKey = getEnv().PERPLEXITY_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "user",
            content: `Find the most recent and relevant news articles about: ${query}\n\nReturn a JSON array of objects with fields: title, url, snippet, publishedAt (ISO date or null). Only return the JSON array, no other text.`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error(`[news-search] Perplexity returned ${res.status}`);
      return [];
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";

    // Extract JSON from the response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const articles = JSON.parse(jsonMatch[0]) as Array<{
      title?: string;
      url?: string;
      snippet?: string;
      publishedAt?: string;
    }>;

    return articles.map((a) => ({
      title: a.title ?? "",
      url: a.url ?? "",
      source: "perplexity",
      snippet: a.snippet ?? "",
      publishedAt: a.publishedAt ?? null,
    }));
  } catch (err) {
    console.error("[news-search] Perplexity error:", err);
    return [];
  }
}

// ─── Google News RSS (free) ───

async function searchGoogleNewsRSS(
  query: string
): Promise<NewsSearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US`,
      { headers: { "User-Agent": "MoonNews/1.0" } }
    );

    if (!res.ok) {
      console.error(`[news-search] Google News RSS returned ${res.status}`);
      return [];
    }

    const xml = await res.text();

    // Parse items from RSS XML
    const items: NewsSearchResult[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const title =
        itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";
      const link =
        itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";
      const description =
        itemXml
          .match(/<description>([\s\S]*?)<\/description>/)?.[1]
          ?.replace(/<[^>]*>/g, "")
          .trim() ?? "";
      const pubDate =
        itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? null;

      if (link) {
        items.push({
          title,
          url: link,
          source: "google_news_rss",
          snippet: description,
          publishedAt: pubDate,
        });
      }
    }

    return items;
  } catch (err) {
    console.error("[news-search] Google News RSS error:", err);
    return [];
  }
}

// ─── Hacker News (Algolia API, free) ───

async function searchHackerNews(
  query: string
): Promise<NewsSearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodedQuery}&tags=story`
    );

    if (!res.ok) {
      console.error(`[news-search] HN returned ${res.status}`);
      return [];
    }

    const data = (await res.json()) as {
      hits?: Array<{
        title?: string;
        url?: string;
        story_text?: string;
        created_at?: string;
        objectID?: string;
      }>;
    };

    return (data.hits ?? [])
      .filter((h) => h.url)
      .map((hit) => ({
        title: hit.title ?? "",
        url: hit.url!,
        source: "hackernews",
        snippet: hit.story_text?.slice(0, 300) ?? "",
        publishedAt: hit.created_at ?? null,
      }));
  } catch (err) {
    console.error("[news-search] HN error:", err);
    return [];
  }
}

// ─── Reddit (JSON API, free) ───

async function searchReddit(query: string): Promise<NewsSearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const res = await fetch(
      `https://www.reddit.com/search.json?q=${encodedQuery}&sort=relevance&t=week`,
      {
        headers: {
          "User-Agent": "MoonNews/1.0 (news-research-bot)",
        },
      }
    );

    if (!res.ok) {
      console.error(`[news-search] Reddit returned ${res.status}`);
      return [];
    }

    const data = (await res.json()) as {
      data?: {
        children?: Array<{
          data?: {
            title?: string;
            url?: string;
            selftext?: string;
            created_utc?: number;
            permalink?: string;
          };
        }>;
      };
    };

    return (data.data?.children ?? []).map((child) => {
      const d = child.data!;
      return {
        title: d.title ?? "",
        url: d.url ?? `https://reddit.com${d.permalink ?? ""}`,
        source: "reddit",
        snippet: d.selftext?.slice(0, 300) ?? "",
        publishedAt: d.created_utc
          ? new Date(d.created_utc * 1000).toISOString()
          : null,
      };
    });
  } catch (err) {
    console.error("[news-search] Reddit error:", err);
    return [];
  }
}

// ─── Main search orchestrator ───

export async function searchNewsStory(
  query: string,
  mode: SearchMode
): Promise<NewsSearchResult[]> {
  const searches: Promise<NewsSearchResult[]>[] =
    mode === "quick"
      ? [searchSerper(query), searchGoogleNewsRSS(query)]
      : [
          searchSerper(query),
          searchPerplexity(query),
          searchGoogleNewsRSS(query),
          searchHackerNews(query),
          searchReddit(query),
        ];

  const settled = await Promise.allSettled(searches);

  const allResults: NewsSearchResult[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      allResults.push(...result.value);
    } else {
      console.error("[news-search] Source failed:", result.reason);
    }
  }

  return deduplicateResults(allResults);
}
