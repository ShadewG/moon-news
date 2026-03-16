import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and, sql } from "drizzle-orm";

import * as schema from "../src/server/db/schema.js";

const { boardSources, boardFeedItems, boardStoryCandidates, boardCompetitorChannels } = schema;

// ─── RSS Feed Sources ───

const RSS_SOURCES = [
  { name: "The Verge", feedUrl: "https://www.theverge.com/rss/index.xml" },
  { name: "TechCrunch", feedUrl: "https://techcrunch.com/feed/" },
  { name: "Ars Technica", feedUrl: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "Hacker News", feedUrl: "https://hnrss.org/frontpage" },
  { name: "CoinDesk", feedUrl: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "EFF", feedUrl: "https://www.eff.org/rss/updates.xml" },
  { name: "ProPublica", feedUrl: "https://feeds.propublica.org/propublica/main" },
  { name: "The Intercept", feedUrl: "https://theintercept.com/feed/?rss" },
  { name: "Wired", feedUrl: "https://www.wired.com/feed/rss" },
  { name: "MIT Tech Review", feedUrl: "https://www.technologyreview.com/feed/" },
];

// ─── Competitor YouTube Channels ───

const COMPETITOR_CHANNELS = [
  // Tier 1
  { name: "Internet Anarchist", channelId: "UCH5fS5pXACF4mT__g4eAVbg", tier: "tier1" as const },
  { name: "Coffeezilla", channelId: "UCFQMnBA3CS502aghlcr0_aw", tier: "tier1" as const },
  { name: "ColdFusion", channelId: "UC4QZ_LsYcvcq7qOsOhpAX4A", tier: "tier1" as const },
  { name: "Patrick Cc:", channelId: "UCclxC_g2CMDOjsbkKkZp4tQ", tier: "tier1" as const },
  { name: "MagnatesMedia", channelId: "UC5_dVaNMjgnRxjmAsRvzYtQ", tier: "tier1" as const },
  // Tier 2
  { name: "LegalEagle", channelId: "UCpa-Zb0ZcQjTCPP1Dx_1M8Q", tier: "tier2" as const },
  { name: "penguinz0", channelId: "UCq6VFHwMzcMXbuKyG7SQYIg", tier: "tier2" as const },
  { name: "SomeOrdinaryGamers", channelId: "UCtMVHI3AJD4Qk4hcbZnI9ZQ", tier: "tier2" as const },
];

// ─── Inline RSS/Atom parser (duplicated to avoid server-only import) ───

interface ParsedFeedItem {
  externalId: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: Date | null;
  summary: string | null;
}

function extractTag(xml: string, tag: string): string | null {
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
  const regex = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    blocks.push(m[0]);
  }
  return blocks;
}

function hashString(str: string): string {
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
  return extractAllBlocks(xml, "item").map((item) => {
    const title = extractTag(item, "title");
    const link = extractTag(item, "link");
    const description = extractTag(item, "description");
    const pubDate = extractTag(item, "pubDate");
    const author =
      extractTag(item, "dc:creator") ?? extractTag(item, "author") ?? extractTag(item, "creator");
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
  return extractAllBlocks(xml, "entry").map((entry) => {
    const title = extractTag(entry, "title");
    const linkHref = extractAttr(entry, "link", "href") ?? extractTag(entry, "link");
    const summary = extractTag(entry, "summary") ?? extractTag(entry, "content");
    const published = extractTag(entry, "published") ?? extractTag(entry, "updated");
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

function parseFeedXml(xml: string): ParsedFeedItem[] {
  if (xml.includes("<feed") && xml.includes('xmlns="http://www.w3.org/2005/Atom"')) {
    return parseAtomEntries(xml);
  }
  if (xml.includes("<feed") && xml.includes("xmlns='http://www.w3.org/2005/Atom'")) {
    return parseAtomEntries(xml);
  }
  if (xml.includes("<feed") && xml.includes("<entry>")) {
    return parseAtomEntries(xml);
  }
  if (xml.includes("<rss") || xml.includes("<channel>")) {
    return parseRssItems(xml);
  }
  const rssItems = parseRssItems(xml);
  if (rssItems.length > 0) return rssItems;
  return parseAtomEntries(xml);
}

// ─── Main ───

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/moon_news";

  console.log("Connecting to database...");
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  try {
    // ─── Seed RSS Sources ───
    console.log("\n--- Seeding RSS Feed Sources ---");

    for (const source of RSS_SOURCES) {
      const [existing] = await db
        .select({ id: boardSources.id })
        .from(boardSources)
        .where(and(eq(boardSources.name, source.name), eq(boardSources.kind, "rss")))
        .limit(1);

      if (existing) {
        await db
          .update(boardSources)
          .set({ configJson: { feedUrl: source.feedUrl }, updatedAt: new Date() })
          .where(eq(boardSources.id, existing.id));
        console.log(`  [update] ${source.name}`);
        continue;
      }

      await db.insert(boardSources).values({
        name: source.name,
        kind: "rss",
        provider: "internal",
        pollIntervalMinutes: 15,
        enabled: true,
        configJson: { feedUrl: source.feedUrl },
      });
      console.log(`  [+] ${source.name}`);
    }

    // ─── Seed Competitor Channels ───
    console.log("\n--- Seeding Competitor YouTube Channels ---");

    for (const channel of COMPETITOR_CHANNELS) {
      const [existing] = await db
        .select({ id: boardCompetitorChannels.id })
        .from(boardCompetitorChannels)
        .where(
          and(
            eq(boardCompetitorChannels.name, channel.name),
            eq(boardCompetitorChannels.platform, "youtube")
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(boardCompetitorChannels)
          .set({
            metadataJson: { channelId: channel.channelId },
            channelUrl: `https://www.youtube.com/channel/${channel.channelId}`,
            tier: channel.tier,
            updatedAt: new Date(),
          })
          .where(eq(boardCompetitorChannels.id, existing.id));
        console.log(`  [update] ${channel.name}`);
        continue;
      }

      await db.insert(boardCompetitorChannels).values({
        name: channel.name,
        platform: "youtube",
        tier: channel.tier,
        channelUrl: `https://www.youtube.com/channel/${channel.channelId}`,
        pollIntervalMinutes: 30,
        enabled: true,
        metadataJson: { channelId: channel.channelId },
      });
      console.log(`  [+] ${channel.name} (${channel.tier})`);
    }

    // ─── Poll All RSS Feeds ───
    console.log("\n--- Polling all RSS feeds ---");

    const sources = await db
      .select()
      .from(boardSources)
      .where(and(eq(boardSources.enabled, true), eq(boardSources.kind, "rss")));

    let feedSucceeded = 0;
    let feedFailed = 0;
    let itemsInserted = 0;

    for (const source of sources) {
      const config = source.configJson as Record<string, unknown> | null;
      const feedUrl = (config?.feedUrl as string) ?? null;

      if (!feedUrl) {
        console.log(`  [skip] ${source.name} -- no feedUrl`);
        continue;
      }

      try {
        const response = await fetch(feedUrl, {
          headers: {
            "User-Agent": "MoonNews/1.0 (RSS Feed Reader)",
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
          },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const xml = await response.text();
        const items = parseFeedXml(xml);
        let sourceInserted = 0;

        for (const item of items) {
          if (!item.url && !item.title) continue;
          try {
            await db
              .insert(schema.boardFeedItems)
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
            sourceInserted++;
          } catch {
            // skip constraint violations
          }
        }

        itemsInserted += sourceInserted;
        feedSucceeded++;

        await db
          .update(boardSources)
          .set({ lastPolledAt: new Date(), lastSuccessAt: new Date(), lastError: null, updatedAt: new Date() })
          .where(eq(boardSources.id, source.id));

        console.log(`  [ok] ${source.name} -- ${sourceInserted} items from ${items.length} parsed`);
      } catch (error) {
        feedFailed++;
        const msg = error instanceof Error ? error.message : String(error);
        await db
          .update(boardSources)
          .set({ lastPolledAt: new Date(), lastError: msg, updatedAt: new Date() })
          .where(eq(boardSources.id, source.id));
        console.log(`  [fail] ${source.name} -- ${msg.slice(0, 100)}`);
      }
    }

    // ─── Poll Competitor YouTube Channels ───
    console.log("\n--- Polling competitor YouTube channels ---");

    const channels = await db
      .select()
      .from(boardCompetitorChannels)
      .where(eq(boardCompetitorChannels.enabled, true));

    let compSucceeded = 0;
    let compFailed = 0;
    let postsInserted = 0;

    for (const channel of channels) {
      const config = channel.metadataJson as Record<string, unknown> | null;
      const channelId = (config?.channelId as string) ?? null;

      if (!channelId) {
        console.log(`  [skip] ${channel.name} -- no channelId`);
        continue;
      }

      try {
        const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        const response = await fetch(feedUrl, {
          headers: { "User-Agent": "MoonNews/1.0 (RSS Feed Reader)" },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const xml = await response.text();
        const entries = parseFeedXml(xml);
        let channelInserted = 0;

        for (const entry of entries) {
          if (!entry.url) continue;
          const videoIdMatch = entry.url.match(
            /(?:watch\?v=|\/videos\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/
          );
          const videoExternalId = videoIdMatch?.[1] ?? hashString(entry.url);

          try {
            await db
              .insert(schema.boardCompetitorPosts)
              .values({
                channelId: channel.id,
                externalId: videoExternalId,
                title: entry.title,
                url: entry.url,
                publishedAt: entry.publishedAt,
              })
              .onConflictDoNothing();
            channelInserted++;
          } catch {
            // skip
          }
        }

        postsInserted += channelInserted;
        compSucceeded++;
        console.log(`  [ok] ${channel.name} -- ${channelInserted} posts from ${entries.length} entries`);
      } catch (error) {
        compFailed++;
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`  [fail] ${channel.name} -- ${msg.slice(0, 100)}`);
      }
    }

    // ─── Summary ───
    const [srcCount] = await db.select({ c: sql<number>`count(*)::int` }).from(boardSources);
    const [itemCount] = await db.select({ c: sql<number>`count(*)::int` }).from(boardFeedItems);
    const [storyCount] = await db.select({ c: sql<number>`count(*)::int` }).from(boardStoryCandidates);
    const [compCount] = await db.select({ c: sql<number>`count(*)::int` }).from(boardCompetitorChannels);

    console.log("\n=== Seed Complete ===");
    console.log(`RSS feeds: ${feedSucceeded} ok, ${feedFailed} failed, ${itemsInserted} items inserted`);
    console.log(`Competitors: ${compSucceeded} ok, ${compFailed} failed, ${postsInserted} posts inserted`);
    console.log(`Totals: ${srcCount.c} sources | ${itemCount.c} feed items | ${storyCount.c} stories | ${compCount.c} competitors`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
