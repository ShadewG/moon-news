import "server-only";

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { extractedContentCache } from "@/server/db/schema";
import { scrapeResearchSource } from "@/server/providers/firecrawl";
import { getEnv } from "@/server/config/env";

// ─── Types ───

export interface ExtractedContent {
  title: string | null;
  content: string;
  author: string | null;
  publishedAt: string | null;
  siteName: string | null;
  wordCount: number;
}

// ─── Helpers ───

function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function stripHtml(html: string): string {
  // Remove script and style blocks entirely
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Remove all HTML tags
  text = text.replace(/<[^>]*>/g, " ");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

// ─── Fallback: direct fetch + strip HTML ───

async function extractWithFetch(
  url: string
): Promise<ExtractedContent | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MoonNews/1.0; +https://moonnews.dev)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;

    const html = await res.text();
    const content = stripHtml(html);

    // Try to extract title from <title> tag
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]).trim() : null;

    // Try to extract meta author
    const authorMatch = html.match(
      /<meta\s+(?:name|property)=["'](?:author|article:author)["']\s+content=["']([^"']+)["']/i
    );
    const author = authorMatch ? authorMatch[1].trim() : null;

    // Try to extract published date
    const dateMatch = html.match(
      /<meta\s+(?:name|property)=["'](?:article:published_time|date|publishedAt)["']\s+content=["']([^"']+)["']/i
    );
    const publishedAt = dateMatch ? dateMatch[1].trim() : null;

    // Try to extract site name
    const siteMatch = html.match(
      /<meta\s+(?:name|property)=["']og:site_name["']\s+content=["']([^"']+)["']/i
    );
    const siteName = siteMatch ? siteMatch[1].trim() : null;

    return {
      title,
      content: content.slice(0, 50_000), // Cap at 50k chars
      author,
      publishedAt,
      siteName,
      wordCount: countWords(content),
    };
  } catch (err) {
    console.error("[content-extractor] Fetch fallback failed:", err);
    return null;
  }
}

// ─── Firecrawl extraction ───

async function extractWithFirecrawl(
  url: string
): Promise<ExtractedContent | null> {
  const firecrawlKey = getEnv().FIRECRAWL_API_KEY;
  if (!firecrawlKey) return null;

  try {
    const result = await scrapeResearchSource(url);
    const content = result.markdown || "";

    return {
      title: result.title,
      content,
      author: null,
      publishedAt: null,
      siteName: result.sourceName,
      wordCount: countWords(content),
    };
  } catch (err) {
    console.error("[content-extractor] Firecrawl failed:", err);
    return null;
  }
}

// ─── Main extraction with cache ───

export async function extractContent(
  url: string
): Promise<ExtractedContent> {
  const db = getDb();
  const urlHash = hashUrl(url);

  // Check cache first
  const cached = await db
    .select()
    .from(extractedContentCache)
    .where(eq(extractedContentCache.urlHash, urlHash))
    .limit(1);

  if (cached.length > 0) {
    const c = cached[0];
    return {
      title: c.title,
      content: c.content,
      author: c.author,
      publishedAt: c.publishedAt,
      siteName: c.siteName,
      wordCount: c.wordCount,
    };
  }

  // Try Firecrawl first, then fallback
  let extracted = await extractWithFirecrawl(url);
  if (!extracted || !extracted.content) {
    extracted = await extractWithFetch(url);
  }

  if (!extracted || !extracted.content) {
    return {
      title: null,
      content: "",
      author: null,
      publishedAt: null,
      siteName: null,
      wordCount: 0,
    };
  }

  // Cache the result
  try {
    await db
      .insert(extractedContentCache)
      .values({
        urlHash,
        url,
        title: extracted.title,
        content: extracted.content,
        author: extracted.author,
        publishedAt: extracted.publishedAt,
        siteName: extracted.siteName,
        wordCount: extracted.wordCount,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error("[content-extractor] Cache insert failed:", err);
  }

  return extracted;
}
