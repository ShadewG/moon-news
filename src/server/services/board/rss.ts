import "server-only";

import { createHash } from "node:crypto";

import { XMLParser } from "fast-xml-parser";

export interface BoardRssFeedItem {
  externalId: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: Date | null;
  summary: string | null;
  contentHash: string;
  metadataJson: Record<string, unknown>;
}

const rssParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  processEntities: false,
  cdataPropName: "cdata",
  textNodeName: "text",
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function readText(value: unknown): string | null {
  if (typeof value === "string") {
    const cleaned = stripHtml(value);
    return cleaned.length > 0 ? cleaned : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  for (const key of ["text", "cdata", "#text", "value"]) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      return readText(candidate);
    }
  }

  return null;
}

function readLink(entry: Record<string, unknown>): string | null {
  const linkValue = entry.link;

  if (typeof linkValue === "string") {
    return linkValue;
  }

  if (Array.isArray(linkValue)) {
    for (const item of linkValue) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const href = (item as Record<string, unknown>).href;
      const rel = (item as Record<string, unknown>).rel;
      if (typeof href === "string" && (rel === undefined || rel === "alternate")) {
        return href;
      }
    }
  }

  if (linkValue && typeof linkValue === "object") {
    const href = (linkValue as Record<string, unknown>).href;
    if (typeof href === "string") {
      return href;
    }

    return readText(linkValue);
  }

  return null;
}

function readAuthor(entry: Record<string, unknown>): string | null {
  const direct = readText(entry.author);
  if (direct) {
    return direct;
  }

  const creator = readText(entry.creator);
  if (creator) {
    return creator;
  }

  const source = readText(entry.source);
  return source;
}

function readPublishedAt(entry: Record<string, unknown>): Date | null {
  for (const key of ["published", "updated", "pubDate", "date", "dc:date"]) {
    const candidate = readText(entry[key]);
    if (!candidate) {
      continue;
    }

    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function buildExternalId(value: { guid?: string | null; url: string; title: string; publishedAt: Date | null }) {
  if (value.guid && value.guid.length > 0) {
    return value.guid;
  }

  if (value.url.length > 0) {
    return value.url;
  }

  return createHash("sha1")
    .update(`${value.title}|${value.publishedAt?.toISOString() ?? "unknown"}`)
    .digest("hex");
}

function buildContentHash(value: { title: string; url: string; summary: string | null }) {
  return createHash("sha1")
    .update(`${value.title}|${value.url}|${value.summary ?? ""}`)
    .digest("hex");
}

function normalizeRssItem(entry: Record<string, unknown>): BoardRssFeedItem | null {
  const title = readText(entry.title);
  const url = readLink(entry) ?? readText(entry.guid);

  if (!title || !url) {
    return null;
  }

  const summary =
    readText(entry.description) ??
    readText(entry.summary) ??
    readText(entry.content) ??
    readText(entry["content:encoded"]);
  const publishedAt = readPublishedAt(entry);
  const guid = readText(entry.guid);

  return {
    externalId: buildExternalId({ guid, url, title, publishedAt }),
    title,
    url,
    author: readAuthor(entry),
    publishedAt,
    summary,
    contentHash: buildContentHash({ title, url, summary }),
    metadataJson: {
      guid,
      category: asArray(entry.category).map((item) => readText(item)).filter(Boolean),
    },
  };
}

function normalizeAtomEntry(entry: Record<string, unknown>): BoardRssFeedItem | null {
  const title = readText(entry.title);
  const url = readLink(entry);

  if (!title || !url) {
    return null;
  }

  const summary =
    readText(entry.summary) ?? readText(entry.content) ?? readText(entry.subtitle);
  const publishedAt = readPublishedAt(entry);
  const guid = readText(entry.id);
  const authorValue = entry.author;
  const author = Array.isArray(authorValue)
    ? readText((authorValue[0] as Record<string, unknown>)?.name ?? authorValue[0])
    : readText((authorValue as Record<string, unknown> | undefined)?.name ?? authorValue);

  return {
    externalId: buildExternalId({ guid, url, title, publishedAt }),
    title,
    url,
    author,
    publishedAt,
    summary,
    contentHash: buildContentHash({ title, url, summary }),
    metadataJson: {
      guid,
      category: asArray(entry.category)
        .map((item) =>
          typeof item === "object" && item !== null
            ? readText((item as Record<string, unknown>).term ?? item)
            : readText(item)
        )
        .filter(Boolean),
    },
  };
}

export function parseBoardRssXml(xml: string): BoardRssFeedItem[] {
  const parsed = rssParser.parse(xml) as Record<string, unknown>;
  const rssItems = asArray(
    ((parsed.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined)
      ?.item
  )
    .map((item) => normalizeRssItem(item as Record<string, unknown>))
    .filter((item): item is BoardRssFeedItem => Boolean(item));

  if (rssItems.length > 0) {
    return rssItems;
  }

  return asArray((parsed.feed as Record<string, unknown> | undefined)?.entry)
    .map((entry) => normalizeAtomEntry(entry as Record<string, unknown>))
    .filter((item): item is BoardRssFeedItem => Boolean(item));
}

export async function fetchBoardRssItems(feedUrl: string): Promise<BoardRssFeedItem[]> {
  const response = await fetch(feedUrl, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "moon-news/1.0 (+https://moon-news-web-production.up.railway.app)",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Feed request failed with ${response.status}`);
  }

  const xml = await response.text();
  return parseBoardRssXml(xml);
}
