"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedItem {
  id: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: string | null;
  ingestedAt: string;
  sentimentScore: number;
  controversyScore: number;
  sourceName: string;
  sourceKind: string;
}

interface SourceStat {
  kind: string;
  count: number;
  latest: string;
}

interface FeedData {
  items: FeedItem[];
  stats: SourceStat[];
  since: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<string, string> = {
  rss: "RSS",
  youtube_channel: "YouTube",
  x_account: "X / Twitter",
  subreddit: "Reddit",
  twitter_trending: "Trends (X)",
  google_trends: "Google Trends",
  tiktok_proxy: "TikTok",
  bluesky: "Bluesky",
};

const KIND_COLORS: Record<string, string> = {
  rss: "#f59e0b",
  youtube_channel: "#ef4444",
  x_account: "#3b82f6",
  subreddit: "#f97316",
  twitter_trending: "#06b6d4",
  google_trends: "#22c55e",
  tiktok_proxy: "#a855f7",
  bluesky: "#60a5fa",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function decode(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&#038;/g, "&")
    .replace(/&#8211;/g, "\u2013");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function IntakeClient() {
  const [data, setData] = useState<FeedData | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/board/intake-feed?limit=200&hours=6");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastRefresh(new Date());
      }
    } catch (err) {
      console.error("Failed to fetch intake feed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchData, 15_000); // 15s
      return () => clearInterval(intervalRef.current!);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
  }, [autoRefresh, fetchData]);

  const filteredItems = data?.items.filter(
    (item) => filter === "all" || item.sourceKind === filter
  ) ?? [];

  const totalCount = data?.items.length ?? 0;

  return (
    <div
      style={{
        background: "#080808",
        color: "#ccc",
        minHeight: "calc(100vh - 32px)",
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #181818",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#0a0a0a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: 0 }}>
            Live Intake Feed
          </h1>
          {autoRefresh && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#22c55e",
                  animation: "pulse 2s infinite",
                }}
              />
              <span style={{ fontSize: 10, color: "#555" }}>LIVE</span>
            </span>
          )}
          <span style={{ fontSize: 10, color: "#444" }}>
            {totalCount} items in last 6h
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#444" }}>
            {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              fontSize: 10,
              padding: "3px 8px",
              background: autoRefresh ? "#1a2a1a" : "#1a1a1a",
              border: `1px solid ${autoRefresh ? "#2a4a2a" : "#282828"}`,
              borderRadius: 3,
              color: autoRefresh ? "#4a8" : "#666",
              cursor: "pointer",
            }}
          >
            {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
          </button>
          <button
            onClick={fetchData}
            style={{
              fontSize: 10,
              padding: "3px 8px",
              background: "#1a1a1a",
              border: "1px solid #282828",
              borderRadius: 3,
              color: "#888",
              cursor: "pointer",
            }}
          >
            Refresh now
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {data?.stats && (
        <div
          style={{
            padding: "8px 16px",
            borderBottom: "1px solid #141414",
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => setFilter("all")}
            style={{
              fontSize: 10,
              padding: "3px 10px",
              background: filter === "all" ? "#1a1a2a" : "#0e0e0e",
              border: `1px solid ${filter === "all" ? "#335" : "#1a1a1a"}`,
              borderRadius: 12,
              color: filter === "all" ? "#aac" : "#555",
              cursor: "pointer",
            }}
          >
            All ({totalCount})
          </button>
          {data.stats
            .sort((a, b) => b.count - a.count)
            .map((stat) => {
              const color = KIND_COLORS[stat.kind] || "#888";
              const active = filter === stat.kind;
              return (
                <button
                  key={stat.kind}
                  onClick={() => setFilter(active ? "all" : stat.kind)}
                  style={{
                    fontSize: 10,
                    padding: "3px 10px",
                    background: active ? `${color}15` : "#0e0e0e",
                    border: `1px solid ${active ? `${color}44` : "#1a1a1a"}`,
                    borderRadius: 12,
                    color: active ? color : "#555",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: color,
                      opacity: 0.7,
                    }}
                  />
                  {KIND_LABELS[stat.kind] || stat.kind} ({stat.count})
                  <span style={{ color: "#444", marginLeft: 2 }}>
                    {timeAgo(stat.latest)}
                  </span>
                </button>
              );
            })}
        </div>
      )}

      {/* Feed */}
      <div style={{ padding: "0 0 20px" }}>
        {loading && (
          <div style={{ padding: 40, textAlign: "center", color: "#444" }}>
            Loading...
          </div>
        )}

        {filteredItems.map((item, i) => {
          const color = KIND_COLORS[item.sourceKind] || "#888";
          const prevItem = filteredItems[i - 1];
          const showTimeDivider =
            i === 0 ||
            (prevItem &&
              new Date(prevItem.ingestedAt).getHours() !==
                new Date(item.ingestedAt).getHours());

          return (
            <div key={item.id}>
              {showTimeDivider && (
                <div
                  style={{
                    padding: "6px 16px",
                    fontSize: 9,
                    color: "#333",
                    background: "#0c0c0c",
                    borderBottom: "1px solid #111",
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    fontWeight: 600,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  {new Date(item.ingestedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  — {timeAgo(item.ingestedAt)}
                </div>
              )}

              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "6px 16px",
                  borderBottom: "1px solid #0f0f0f",
                  textDecoration: "none",
                  color: "inherit",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#0e0e0e")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {/* Source badge */}
                <span
                  style={{
                    fontSize: 9,
                    padding: "2px 6px",
                    background: `${color}15`,
                    border: `1px solid ${color}33`,
                    borderRadius: 3,
                    color,
                    whiteSpace: "nowrap",
                    minWidth: 55,
                    textAlign: "center",
                    marginTop: 1,
                    flexShrink: 0,
                  }}
                >
                  {KIND_LABELS[item.sourceKind] || item.sourceKind}
                </span>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#ddd",
                      lineHeight: 1.35,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {decode(item.title)}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#444",
                      marginTop: 2,
                      display: "flex",
                      gap: 8,
                    }}
                  >
                    <span>{item.sourceName}</span>
                    {item.author && <span>by {item.author}</span>}
                    {item.controversyScore > 0 && (
                      <span style={{ color: "#c44" }}>
                        controversy: {item.controversyScore}
                      </span>
                    )}
                  </div>
                </div>

                {/* Time */}
                <span
                  style={{
                    fontSize: 10,
                    color: "#333",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {timeAgo(item.ingestedAt)}
                </span>
              </a>
            </div>
          );
        })}

        {!loading && filteredItems.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "#444" }}>
            No items in the last 6 hours
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
