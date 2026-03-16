import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  boardCompetitorChannels,
  boardCompetitorPosts,
  boardFeedItems,
  boardSources,
} from "@/server/db/schema";

// ─── RSS / Atom XML Parsing (regex-based, no npm dependency) ───

interface ParsedFeedItem {
  externalId: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: Date | null;
  summary: string | null;
}

function extractTag(xml: string, tag: string): string | null {
  // Handle both <tag>content</tag> and <tag attr="...">content</tag>
  const regex = new RegExp(
    `<${tag}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`,
    "i"
  );
  const match = xml.match(regex);
  if (!match) return null;
  const value = (match[1] ?? match[2] ?? "").trim();
  return value || null;
}

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, "i");
  const match = xml.match(regex);
  return match?.[1]?.trim() ?? null;
}

function extractAllBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const regex = new RegExp(
    `<${tag}[\\s>][\\s\\S]*?</${tag}>`,
    "gi"
  );
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    blocks.push(m[0]);
  }
  return blocks;
}

function hashString(str: string): string {
  // Simple hash for deduplication — FNV-1a style
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function parseRssItems(xml: string): ParsedFeedItem[] {
  const items = extractAllBlocks(xml, "item");
  return items.map((item) => {
    const title = extractTag(item, "title");
    const link = extractTag(item, "link");
    const description = extractTag(item, "description");
    const pubDate = extractTag(item, "pubDate");
    const author =
      extractTag(item, "dc:creator") ??
      extractTag(item, "author") ??
      extractTag(item, "creator");
    const guid = extractTag(item, "guid");

    const url = link ?? guid ?? "";
    const externalId = hashString(url || title || "");

    return {
      externalId,
      title: title ? stripHtml(title) : "(no title)",
      url,
      author: author ? stripHtml(author) : null,
      publishedAt: parseDate(pubDate),
      summary: description ? stripHtml(description).slice(0, 2000) : null,
    };
  });
}

function parseAtomEntries(xml: string): ParsedFeedItem[] {
  const entries = extractAllBlocks(xml, "entry");
  return entries.map((entry) => {
    const title = extractTag(entry, "title");
    const linkHref =
      extractAttr(entry, "link", "href") ?? extractTag(entry, "link");
    const summary =
      extractTag(entry, "summary") ?? extractTag(entry, "content");
    const published =
      extractTag(entry, "published") ?? extractTag(entry, "updated");
    const authorBlock = extractTag(entry, "author");
    const author = authorBlock ? extractTag(authorBlock, "name") : null;
    const id = extractTag(entry, "id");

    const url = linkHref ?? id ?? "";
    const externalId = hashString(url || title || "");

    return {
      externalId,
      title: title ? stripHtml(title) : "(no title)",
      url,
      author: author ? stripHtml(author) : null,
      publishedAt: parseDate(published),
      summary: summary ? stripHtml(summary).slice(0, 2000) : null,
    };
  });
}

export function parseFeedXml(
  xml: string,
  _sourceKind: string = "rss"
): ParsedFeedItem[] {
  // Detect Atom vs RSS
  if (xml.includes("<feed") && xml.includes("xmlns=\"http://www.w3.org/2005/Atom\"")) {
    return parseAtomEntries(xml);
  }
  if (xml.includes("<feed") && xml.includes("xmlns='http://www.w3.org/2005/Atom'")) {
    return parseAtomEntries(xml);
  }
  // YouTube feeds are Atom but may not match the exact xmlns check above
  if (xml.includes("<feed") && xml.includes("<entry>")) {
    return parseAtomEntries(xml);
  }
  if (xml.includes("<rss") || xml.includes("<channel>")) {
    return parseRssItems(xml);
  }

  // Try both and return whichever produces results
  const rssItems = parseRssItems(xml);
  if (rssItems.length > 0) return rssItems;

  const atomItems = parseAtomEntries(xml);
  if (atomItems.length > 0) return atomItems;

  return [];
}

// ─── Feed Polling ───

export async function pollSingleFeed(sourceId: string): Promise<number> {
  const db = getDb();

  const [source] = await db
    .select()
    .from(boardSources)
    .where(eq(boardSources.id, sourceId))
    .limit(1);

  if (!source) {
    throw new Error(`Board source not found: ${sourceId}`);
  }

  const config = source.configJson as Record<string, unknown> | null;
  const feedUrl = (config?.feedUrl as string) ?? null;

  if (!feedUrl) {
    await db
      .update(boardSources)
      .set({
        lastError: "No feedUrl in configJson",
        lastPolledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(boardSources.id, sourceId));
    return 0;
  }

  try {
    const response = await fetch(feedUrl, {
      headers: {
        "User-Agent": "MoonNews/1.0 (RSS Feed Reader)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xml = await response.text();
    const items = parseFeedXml(xml, source.kind);

    let insertedCount = 0;

    for (const item of items) {
      if (!item.url && !item.title) continue;

      try {
        await db
          .insert(boardFeedItems)
          .values({
            sourceId: source.id,
            externalId: item.externalId,
            title: item.title,
            url: item.url,
            author: item.author,
            publishedAt: item.publishedAt,
            summary: item.summary,
            contentHash: hashString(item.title + item.url),
          })
          .onConflictDoNothing();

        insertedCount++;
      } catch {
        // Skip individual item failures (likely constraint violations)
      }
    }

    await db
      .update(boardSources)
      .set({
        lastPolledAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(boardSources.id, sourceId));

    return insertedCount;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown poll failure";

    await db
      .update(boardSources)
      .set({
        lastPolledAt: new Date(),
        lastError: message,
        updatedAt: new Date(),
      })
      .where(eq(boardSources.id, sourceId));

    return 0;
  }
}

export async function pollAllFeeds(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  itemsInserted: number;
}> {
  const db = getDb();

  const sources = await db
    .select()
    .from(boardSources)
    .where(eq(boardSources.enabled, true));

  let succeeded = 0;
  let failed = 0;
  let itemsInserted = 0;

  for (const source of sources) {
    try {
      const count = await pollSingleFeed(source.id);
      itemsInserted += count;
      succeeded++;
    } catch {
      failed++;
    }
  }

  return {
    total: sources.length,
    succeeded,
    failed,
    itemsInserted,
  };
}

// ─── Competitor Channel Polling ───

export async function pollCompetitorChannels(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  postsInserted: number;
}> {
  const db = getDb();

  const channels = await db
    .select()
    .from(boardCompetitorChannels)
    .where(eq(boardCompetitorChannels.enabled, true));

  let succeeded = 0;
  let failed = 0;
  let postsInserted = 0;

  for (const channel of channels) {
    try {
      const config = channel.metadataJson as Record<string, unknown> | null;
      const channelId = (config?.channelId as string) ?? null;

      if (!channelId) {
        failed++;
        continue;
      }

      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

      const response = await fetch(feedUrl, {
        headers: {
          "User-Agent": "MoonNews/1.0 (RSS Feed Reader)",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        failed++;
        continue;
      }

      const xml = await response.text();
      const entries = parseFeedXml(xml, "youtube_channel");

      for (const entry of entries) {
        if (!entry.url) continue;

        // Extract YouTube video ID from URL
        const videoIdMatch = entry.url.match(
          /(?:watch\?v=|\/videos\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/
        );
        const videoExternalId = videoIdMatch?.[1] ?? hashString(entry.url);

        try {
          await db
            .insert(boardCompetitorPosts)
            .values({
              channelId: channel.id,
              externalId: videoExternalId,
              title: entry.title,
              url: entry.url,
              publishedAt: entry.publishedAt,
            })
            .onConflictDoNothing();

          postsInserted++;
        } catch {
          // Skip individual insert failures
        }
      }

      succeeded++;
    } catch {
      failed++;
    }
  }

  return {
    total: channels.length,
    succeeded,
    failed,
    postsInserted,
  };
}

// ─── Queries ───

export async function getRecentFeedItems(
  limit: number = 50,
  sourceKind?: string
) {
  const db = getDb();

  const filters = [];
  if (sourceKind) {
    filters.push(
      sql`${boardFeedItems.sourceId} IN (
        SELECT id FROM board_sources WHERE kind = ${sourceKind}
      )`
    );
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  return db
    .select({
      item: boardFeedItems,
      sourceName: boardSources.name,
      sourceKind: boardSources.kind,
    })
    .from(boardFeedItems)
    .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
    .where(whereClause)
    .orderBy(desc(boardFeedItems.publishedAt))
    .limit(limit);
}

export async function getFeedHealth() {
  const db = getDb();

  const sources = await db
    .select({
      id: boardSources.id,
      name: boardSources.name,
      kind: boardSources.kind,
      enabled: boardSources.enabled,
      lastPolledAt: boardSources.lastPolledAt,
      lastSuccessAt: boardSources.lastSuccessAt,
      lastError: boardSources.lastError,
      itemCount: sql<number>`(
        SELECT count(*)::int FROM board_feed_items
        WHERE source_id = ${boardSources.id}
      )`,
    })
    .from(boardSources)
    .orderBy(boardSources.name);

  return sources;
}
