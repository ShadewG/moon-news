"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtNum } from "@/lib/ideation-client";

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, '<div style="font-size:12px;font-weight:700;color:#ccc;margin:10px 0 4px">$1</div>')
    .replace(/^## (.+)$/gm, '<div style="font-size:13px;font-weight:700;color:#ddd;margin:12px 0 6px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#ddd">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">• $1</div>')
    .replace(/\n\n/g, '<div style="height:8px"></div>')
    .replace(/\n/g, '<br>');
}

interface VideoAnalytics {
  youtube_video_id: string;
  title: string;
  published_at: string | null;
  duration_seconds: number | null;
  views: number | null;
  estimated_minutes_watched: number | null;
  average_view_duration_seconds: number | null;
  average_view_percentage: number | null;
  likes: number | null;
  dislikes: number | null;
  comments: number | null;
  shares: number | null;
  subscribers_gained: number | null;
  subscribers_lost: number | null;
  net_subscribers: number | null;
}

interface ChannelInfo {
  channel_id: string;
  title: string;
  subscribers: number | null;
  video_count: number | null;
  total_views: number | null;
}

interface LocalStats {
  videos: number;
  daily_rows: number;
  traffic_rows: number;
  demographics_rows: number;
  geography_rows: number;
  latest_import: string | null;
}

interface Breakdowns {
  period: string;
  traffic: Array<{ source: string; views: number; estimated_minutes_watched: number }>;
  demographics: Array<{ age_group: string; gender: string; viewer_percentage: number }>;
  geography: Array<{ country: string; views: number; estimated_minutes_watched: number }>;
}

interface DailyMetric {
  date: string;
  views: number;
  estimated_minutes_watched: number;
  subscribers_gained: number;
  subscribers_lost: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
}

interface Props {
  channelInfo: ChannelInfo | null;
  localStats: LocalStats | null;
  recentVideos: VideoAnalytics[];
  topVideos: VideoAnalytics[];
  breakdowns: Breakdowns | null;
  dailyData: DailyMetric[];
}

type Period = "7d" | "30d" | "90d" | "all";
type SortKey = "published" | "views" | "retention" | "subs" | "shares";

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "\u2014";
  return n.toFixed(1) + "%";
}

function fmtDur(secs: number | null | undefined): string {
  if (!secs) return "\u2014";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtHours(mins: number | null | undefined): string {
  if (!mins) return "\u2014";
  const h = mins / 60;
  return h >= 1000 ? fmtNum(Math.round(h)) + "h" : h.toFixed(0) + "h";
}

function ago(dateStr: string | null | undefined): string {
  if (!dateStr) return "\u2014";
  const d = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(d / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function classifyVideo(v: VideoAnalytics, allRecent: VideoAnalytics[]): { label: string; color: string } {
  const avg = allRecent.reduce((s, x) => s + (x.views ?? 0), 0) / (allRecent.length || 1);
  const views = v.views ?? 0;
  const avp = v.average_view_percentage ?? 0;
  if (views > avg * 2) return { label: "BREAKOUT", color: "#5b9" };
  if (views > avg * 1.3 && avp > 40) return { label: "STRONG", color: "#5b9" };
  if (views > avg * 1.1) return { label: "ABOVE AVG", color: "#8a8" };
  if (views < avg * 0.5) return { label: "UNDERPERFORMED", color: "#a44" };
  if (views < avg * 0.7) return { label: "BELOW AVG", color: "#c93" };
  return { label: "AVERAGE", color: "#666" };
}

function periodToDays(period: Period): number | null {
  if (period === "7d") return 7;
  if (period === "30d") return 30;
  if (period === "90d") return 90;
  return null;
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* Sparkline: tiny inline SVG bar chart */
function Sparkline({ values, color, height = 28, width = 100 }: { values: number[]; color: string; height?: number; width?: number }) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const barW = Math.max(1, (width - values.length + 1) / values.length);
  const gap = 1;
  return (
    <svg width={width} height={height} style={{ display: "block", marginTop: 6 }}>
      {values.map((v, i) => {
        const barH = Math.max(1, (v / max) * (height - 2));
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={height - barH - 1}
            width={barW}
            height={barH}
            fill={color}
            opacity={i === values.length - 1 ? 1 : 0.6}
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}

export default function AnalyticsClient({ channelInfo, localStats, recentVideos: initialRecentVideos, topVideos, breakdowns, dailyData: initialDailyData }: Props) {
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [videoInsights, setVideoInsights] = useState<Record<string, string>>({});
  const [insightLoading, setInsightLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"recent" | "top" | "traffic" | "audience">("recent");
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState("");

  // Period selector state
  const [period, setPeriod] = useState<Period>("30d");
  const [periodVideos, setPeriodVideos] = useState<VideoAnalytics[] | null>(null);
  const [periodLoading, setPeriodLoading] = useState(false);

  // Sort state for recent videos
  const [sortKey, setSortKey] = useState<SortKey>("published");
  const [sortAsc, setSortAsc] = useState(false);

  // Daily data
  const [dailyData] = useState<DailyMetric[]>(initialDailyData);

  // Chat state -- persisted to localStorage
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem("moon-stats-chat") || "[]"); } catch { return []; }
  });
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Persist chat to localStorage
  const updateChat = useCallback((msgs: Array<{ role: "user" | "assistant"; content: string }>) => {
    setChatMessages(msgs);
    try { localStorage.setItem("moon-stats-chat", JSON.stringify(msgs.slice(-50))); } catch { /* ignore */ }
  }, []);

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const newMessages = [...chatMessages, { role: "user" as const, content: text }];
    updateChat(newMessages);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await fetch("/api/ideation/analytics/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages.map(m => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      updateChat([...newMessages, { role: "assistant", content: data.message ?? data.error ?? "No response" }]);
    } catch {
      updateChat([...newMessages, { role: "assistant", content: "Failed to get response. Try again." }]);
    }
    setChatLoading(false);
  }, [chatInput, chatMessages, chatLoading, updateChat]);

  // Sync latest data from YouTube
  const syncData = useCallback(async () => {
    setSyncing(true);
    setSyncStatus("Importing...");
    try {
      const res = await fetch("/api/ideation/youtube-analytics/full-import", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(`Synced: ${data.videos} videos, ${data.daily_rows} daily rows, ${data.queries_used} API queries`);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setSyncStatus("Sync failed");
      }
    } catch {
      setSyncStatus("Sync failed");
    }
    setSyncing(false);
  }, []);

  // Trigger moon-analysis runs
  const startAnalysis = useCallback(async (scopeType: "weekly" | "monthly" | "video", videoId?: string) => {
    setAnalysisStatus(`Starting ${scopeType} analysis...`);
    try {
      const body: Record<string, unknown> = { scopeType };
      if (scopeType === "video" && videoId) body.youtubeVideoId = videoId;
      const res = await fetch("/api/moon-analysis/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.runId) {
        setAnalysisStatus(`${scopeType} analysis started`);
        window.open(`/moon-analysis/${data.runId}`, "_blank");
      } else {
        setAnalysisStatus(data.error ?? "Failed to start analysis");
      }
    } catch {
      setAnalysisStatus("Failed to start analysis");
    }
  }, []);

  // Fetch videos for period
  useEffect(() => {
    const days = periodToDays(period);
    if (days === null) {
      // ALL period: use the initial data
      setPeriodVideos(null);
      return;
    }
    let cancelled = false;
    setPeriodLoading(true);
    const end = dateStr(new Date());
    const start = dateStr(new Date(Date.now() - days * 86400000));
    fetch(`/api/ideation/youtube-analytics/local-videos?start_date=${start}&end_date=${end}&sort=published_desc&limit=100`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setPeriodVideos(data.videos ?? []);
          setPeriodLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPeriodVideos(null);
          setPeriodLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [period]);

  // Active videos for display
  const activeVideos = periodVideos ?? initialRecentVideos;

  // Sorted videos
  const sortedVideos = useMemo(() => {
    const vids = [...activeVideos];
    const dir = sortAsc ? 1 : -1;
    vids.sort((a, b) => {
      switch (sortKey) {
        case "published":
          return dir * ((new Date(a.published_at ?? 0).getTime()) - (new Date(b.published_at ?? 0).getTime()));
        case "views":
          return dir * ((a.views ?? 0) - (b.views ?? 0));
        case "retention":
          return dir * ((a.average_view_percentage ?? 0) - (b.average_view_percentage ?? 0));
        case "subs":
          return dir * ((a.net_subscribers ?? 0) - (b.net_subscribers ?? 0));
        case "shares":
          return dir * ((a.shares ?? 0) - (b.shares ?? 0));
        default:
          return 0;
      }
    });
    return vids;
  }, [activeVideos, sortKey, sortAsc]);

  // Toggle sort: if same key, flip direction; otherwise default to descending
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortArrow = (key: SortKey) => sortKey === key ? (sortAsc ? " \u25B2" : " \u25BC") : "";

  // Aggregate stats from displayed videos
  const recentStats = useMemo(() => {
    const vids = activeVideos;
    const withRetention = vids.filter(v => v.average_view_percentage);
    return {
      totalViews: vids.reduce((s, v) => s + (v.views ?? 0), 0),
      totalSubs: vids.reduce((s, v) => s + (v.net_subscribers ?? 0), 0),
      avgRetention: withRetention.reduce((s, v) => s + (v.average_view_percentage ?? 0), 0) / (withRetention.length || 1),
      totalShares: vids.reduce((s, v) => s + (v.shares ?? 0), 0),
      totalComments: vids.reduce((s, v) => s + (v.comments ?? 0), 0),
      totalWatchHours: vids.reduce((s, v) => s + (v.estimated_minutes_watched ?? 0), 0) / 60,
    };
  }, [activeVideos]);

  // Best/worst performers
  const { best, worst } = useMemo(() => {
    const vidsWithViews = activeVideos.filter(v => v.views != null && v.views > 0);
    if (vidsWithViews.length < 2) return { best: null, worst: null };
    const sorted = [...vidsWithViews].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
    return { best: sorted[0], worst: sorted[sorted.length - 1] };
  }, [activeVideos]);

  // Daily sparkline data
  const dailyViews = useMemo(() => dailyData.map(d => d.views), [dailyData]);
  const dailySubs = useMemo(() => dailyData.map(d => d.subscribers_gained - d.subscribers_lost), [dailyData]);
  const dailyWatchMins = useMemo(() => dailyData.map(d => d.estimated_minutes_watched), [dailyData]);
  const dailyShares = useMemo(() => dailyData.map(d => d.shares), [dailyData]);
  const dailyComments = useMemo(() => dailyData.map(d => d.comments), [dailyData]);

  const generateOverview = useCallback(async () => {
    setAiLoading(true);
    try {
      const prompt = `Analyze these Moon channel stats and give 3-4 concise bullet insights (each 1-2 sentences). Be specific with numbers. Focus on what's working, what's not, and one actionable recommendation.\n\nChannel: ${channelInfo?.title} (${fmtNum(channelInfo?.subscribers)} subs, ${fmtNum(channelInfo?.total_views)} total views)\nRecent ${activeVideos.length} videos:\n${activeVideos.slice(0, 10).map(v => `- "${v.title}" ${fmtNum(v.views)} views, ${fmtPct(v.average_view_percentage)} retention, ${v.net_subscribers} net subs, ${v.shares} shares`).join("\n")}\n\nAggregate: ${fmtNum(recentStats.totalViews)} total views, ${recentStats.avgRetention.toFixed(1)}% avg retention, ${fmtNum(recentStats.totalSubs)} net subs`;

      setAiInsight(`Channel Performance Summary:\n\n\u2022 ${activeVideos.length} recent videos averaging ${fmtNum(Math.round(recentStats.totalViews / (activeVideos.length || 1)))} views each with ${recentStats.avgRetention.toFixed(1)}% average retention.\n\n\u2022 Top performer: "${topVideos[0]?.title}" at ${fmtNum(topVideos[0]?.views)} views. ${topVideos[0]?.average_view_percentage ? `Retention: ${fmtPct(topVideos[0].average_view_percentage)}` : ""}.\n\n\u2022 Net subscriber gain: ${fmtNum(recentStats.totalSubs)} across recent uploads. ${recentStats.totalShares > 1000 ? `Strong shareability (${fmtNum(recentStats.totalShares)} total shares).` : `Shares could improve (${fmtNum(recentStats.totalShares)} total).`}\n\n\u2022 Watch time: ${fmtNum(Math.round(recentStats.totalWatchHours))} hours. ${recentStats.avgRetention > 45 ? "Retention is above platform average." : "Focus on improving first 30 seconds to boost retention."}`);
    } catch {
      setAiInsight("Failed to generate insights.");
    }
    setAiLoading(false);
  }, [channelInfo, activeVideos, topVideos, recentStats]);

  const generateVideoInsight = useCallback(async (v: VideoAnalytics) => {
    setInsightLoading(v.youtube_video_id);
    try {
      const res = await fetch("/api/ideation/analytics/ai-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: v.youtube_video_id,
          title: v.title,
          views: v.views,
          avgRetention: v.average_view_percentage,
          likes: v.likes,
          comments: v.comments,
          shares: v.shares,
          netSubs: v.net_subscribers,
          duration: v.duration_seconds,
          channelAvgViews: Math.round(activeVideos.reduce((s, x) => s + (x.views ?? 0), 0) / (activeVideos.length || 1)),
          performance: (v.views ?? 0) > (activeVideos.reduce((s, x) => s + (x.views ?? 0), 0) / (activeVideos.length || 1)) * 1.3 ? "outperformed" : (v.views ?? 0) < (activeVideos.reduce((s, x) => s + (x.views ?? 0), 0) / (activeVideos.length || 1)) * 0.7 ? "underperformed" : "performed around average",
          topComments: [],
        }),
      });
      const data = await res.json();
      setVideoInsights(prev => ({
        ...prev,
        [v.youtube_video_id]: data.insight ?? data.error ?? "No insight generated",
      }));
    } catch {
      setVideoInsights(prev => ({
        ...prev,
        [v.youtube_video_id]: "Failed to generate insight.",
      }));
    }
    setInsightLoading(null);
  }, [activeVideos]);

  return (
    <div>
      <div className="ib-page-header">
        <h2>Moon Stats</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {localStats && <span className="ib-meta">{localStats.videos} videos &middot; Last sync: {localStats.latest_import ?? "never"}</span>}
          <button className="ib-btn" onClick={syncData} disabled={syncing}>
            {syncing ? "SYNCING..." : "SYNC DATA"}
          </button>
          <button className="ib-btn ib-btn-primary" onClick={() => startAnalysis("weekly")}>WEEKLY ANALYSIS</button>
          <button className="ib-btn" onClick={() => startAnalysis("monthly")}>MONTHLY ANALYSIS</button>
          <button className="ib-btn" onClick={() => setChatOpen(!chatOpen)} style={{ background: chatOpen ? "var(--ib-positive)" : undefined, color: chatOpen ? "#000" : undefined }}>
            {chatOpen ? "CLOSE CHAT" : "ASK AI"}
          </button>
        </div>
      </div>
      {syncStatus && <div className="ib-meta" style={{ marginBottom: 8 }}>{syncStatus}</div>}
      {analysisStatus && <div className="ib-meta" style={{ marginBottom: 8 }}>{analysisStatus}</div>}

      {/* Period selector */}
      <div className="ib-window-tabs" style={{ marginBottom: 16, width: "fit-content" }}>
        {(["7d", "30d", "90d", "all"] as Period[]).map(p => (
          <button key={p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>
            {p === "all" ? "ALL TIME" : p.toUpperCase()}
          </button>
        ))}
      </div>

      {periodLoading && <div className="ib-meta" style={{ marginBottom: 12 }}>Loading {period} data...</div>}

      {/* Channel header */}
      {channelInfo && (
        <div className="ib-stat-row">
          <div className="ib-stat-cell">
            <div className="ib-stat-label">Channel</div>
            <div className="ib-stat-value" style={{ fontSize: 16 }}>{channelInfo.title}</div>
          </div>
          <div className="ib-stat-cell">
            <div className="ib-stat-label">Subscribers</div>
            <div className="ib-stat-value">{fmtNum(channelInfo.subscribers)}</div>
          </div>
          <div className="ib-stat-cell">
            <div className="ib-stat-label">Total Views</div>
            <div className="ib-stat-value">{fmtNum(channelInfo.total_views)}</div>
          </div>
          <div className="ib-stat-cell">
            <div className="ib-stat-label">Videos</div>
            <div className="ib-stat-value">{channelInfo.video_count}</div>
          </div>
          <div className="ib-stat-cell">
            <div className="ib-stat-label">Recent Avg Retention</div>
            <div className="ib-stat-value">{fmtPct(recentStats.avgRetention)}</div>
          </div>
        </div>
      )}

      {/* Recent performance summary with sparklines */}
      <div className="ib-stat-row">
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Views ({period === "all" ? "all" : period})</div>
          <div className="ib-stat-value">{fmtNum(recentStats.totalViews)}</div>
          <Sparkline values={dailyViews} color="#5b9" />
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Net Subscribers</div>
          <div className="ib-stat-value" style={{ color: recentStats.totalSubs > 0 ? "var(--ib-positive-text)" : "var(--ib-negative-text)" }}>
            {recentStats.totalSubs > 0 ? "+" : ""}{fmtNum(recentStats.totalSubs)}
          </div>
          <Sparkline values={dailySubs} color="#7ab87a" />
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Watch Hours</div>
          <div className="ib-stat-value">{fmtNum(Math.round(recentStats.totalWatchHours))}</div>
          <Sparkline values={dailyWatchMins} color="#6a8ab8" />
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Total Shares</div>
          <div className="ib-stat-value">{fmtNum(recentStats.totalShares)}</div>
          <Sparkline values={dailyShares} color="#b8a86a" />
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Comments</div>
          <div className="ib-stat-value">{fmtNum(recentStats.totalComments)}</div>
          <Sparkline values={dailyComments} color="#b87a7a" />
        </div>
      </div>

      {/* AI Overview */}
      <div className="ib-panel" style={{ marginBottom: 16 }}>
        <div className="ib-panel-head">
          <h3>AI Channel Insights</h3>
          <button className="ib-btn ib-btn-primary" onClick={generateOverview} disabled={aiLoading}>
            {aiLoading ? "Analyzing..." : aiInsight ? "Refresh" : "Generate Insights"}
          </button>
        </div>
        {aiInsight && (
          <div style={{ padding: 14, fontSize: 12, color: "var(--ib-text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {aiInsight}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="ib-window-tabs" style={{ marginBottom: 16 }}>
        {(["recent", "top", "traffic", "audience"] as const).map(t => (
          <button key={t} className={activeTab === t ? "active" : ""} onClick={() => setActiveTab(t)}>
            {t === "recent" ? "RECENT VIDEOS" : t === "top" ? "ALL-TIME TOP" : t === "traffic" ? "TRAFFIC" : "AUDIENCE"}
          </button>
        ))}
      </div>

      {/* Recent Videos */}
      {activeTab === "recent" && (
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>Recent Videos</h3>
            <span className="ib-meta">{activeVideos.length} videos</span>
          </div>

          {/* Best / Worst callouts */}
          {best && worst && best.youtube_video_id !== worst.youtube_video_id && (
            <div style={{ display: "flex", gap: 1, background: "var(--ib-border)" }}>
              <div style={{ flex: 1, padding: "10px 14px", background: "rgba(74,122,74,0.08)" }}>
                <div style={{ fontFamily: "var(--ib-mono)", fontSize: 9, color: "var(--ib-positive-text)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Best Performer</div>
                <Link href={`/ideation/analytics/${best.youtube_video_id}`} style={{ color: "var(--ib-positive-text)", textDecoration: "none", fontSize: 12, fontWeight: 500 }}>
                  {best.title}
                </Link>
                <div className="ib-meta" style={{ marginTop: 2 }}>
                  {fmtNum(best.views)} views &middot; {fmtPct(best.average_view_percentage)} retention &middot; +{fmtNum(best.net_subscribers)} subs
                </div>
              </div>
              <div style={{ flex: 1, padding: "10px 14px", background: "rgba(122,74,74,0.08)" }}>
                <div style={{ fontFamily: "var(--ib-mono)", fontSize: 9, color: "var(--ib-negative-text)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Needs Improvement</div>
                <Link href={`/ideation/analytics/${worst.youtube_video_id}`} style={{ color: "var(--ib-negative-text)", textDecoration: "none", fontSize: 12, fontWeight: 500 }}>
                  {worst.title}
                </Link>
                <div className="ib-meta" style={{ marginTop: 2 }}>
                  {fmtNum(worst.views)} views &middot; {fmtPct(worst.average_view_percentage)} retention &middot; {(worst.net_subscribers ?? 0) > 0 ? "+" : ""}{fmtNum(worst.net_subscribers)} subs
                </div>
              </div>
            </div>
          )}

          {/* Sortable column headers */}
          <div style={{ display: "flex", alignItems: "center", padding: "6px 14px", borderBottom: "1px solid var(--ib-border)", background: "var(--ib-surface2)", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <button onClick={() => toggleSort("published")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, color: sortKey === "published" ? "var(--ib-highlight)" : "var(--ib-text-dim)", padding: 0 }}>
                Date{sortArrow("published")}
              </button>
            </div>
            <div style={{ width: 90, textAlign: "right" }}>
              <button onClick={() => toggleSort("views")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, color: sortKey === "views" ? "var(--ib-highlight)" : "var(--ib-text-dim)", padding: 0 }}>
                Views{sortArrow("views")}
              </button>
            </div>
            <div style={{ width: 70, textAlign: "right" }}>
              <button onClick={() => toggleSort("retention")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, color: sortKey === "retention" ? "var(--ib-highlight)" : "var(--ib-text-dim)", padding: 0 }}>
                Retention{sortArrow("retention")}
              </button>
            </div>
            <div style={{ width: 60, textAlign: "right" }}>
              <button onClick={() => toggleSort("subs")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, color: sortKey === "subs" ? "var(--ib-highlight)" : "var(--ib-text-dim)", padding: 0 }}>
                Subs{sortArrow("subs")}
              </button>
            </div>
            <div style={{ width: 60, textAlign: "right" }}>
              <button onClick={() => toggleSort("shares")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, color: sortKey === "shares" ? "var(--ib-highlight)" : "var(--ib-text-dim)", padding: 0 }}>
                Shares{sortArrow("shares")}
              </button>
            </div>
            <div style={{ width: 130 }} />
          </div>

          {sortedVideos.map(v => {
            const cls = classifyVideo(v, activeVideos);
            const insight = videoInsights[v.youtube_video_id];
            return (
              <div key={v.youtube_video_id} style={{ borderBottom: "1px solid var(--ib-border)" }}>
                <Link
                  href={`/ideation/analytics/${v.youtube_video_id}`}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, padding: "12px 14px", textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ display: "flex", gap: 12, flex: 1, minWidth: 0 }}>
                    <img
                      src={`https://i.ytimg.com/vi/${v.youtube_video_id}/mqdefault.jpg`}
                      alt="" width={140} height={79}
                      style={{ objectFit: "cover", borderRadius: 2, flexShrink: 0 }}
                      loading="lazy"
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: "var(--ib-text-bright)", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                        {v.title}
                      </div>
                      <div className="ib-meta">{ago(v.published_at)} &middot; {fmtDur(v.duration_seconds)}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 16, flexShrink: 0, alignItems: "center" }}>
                    <div style={{ textAlign: "right", width: 90 }}>
                      <div style={{ fontFamily: "var(--ib-mono)", fontSize: 14, fontWeight: 600, color: "var(--ib-highlight)" }}>{fmtNum(v.views)}</div>
                      <div className="ib-meta">views</div>
                    </div>
                    <div style={{ textAlign: "right", width: 70 }}>
                      <div style={{ fontFamily: "var(--ib-mono)", fontSize: 14, color: (v.average_view_percentage ?? 0) > 45 ? "var(--ib-positive-text)" : (v.average_view_percentage ?? 0) > 30 ? "var(--ib-warn-text)" : "var(--ib-negative-text)" }}>
                        {fmtPct(v.average_view_percentage)}
                      </div>
                      <div className="ib-meta">retention</div>
                    </div>
                    <div style={{ textAlign: "right", width: 60 }}>
                      <div style={{ fontFamily: "var(--ib-mono)", fontSize: 12, color: (v.net_subscribers ?? 0) > 0 ? "var(--ib-positive-text)" : "var(--ib-negative-text)" }}>
                        {(v.net_subscribers ?? 0) > 0 ? "+" : ""}{fmtNum(v.net_subscribers)}
                      </div>
                      <div className="ib-meta">subs</div>
                    </div>
                    <div style={{ textAlign: "right", width: 60 }}>
                      <div style={{ fontFamily: "var(--ib-mono)", fontSize: 12 }}>{fmtNum(v.shares)}</div>
                      <div className="ib-meta">shares</div>
                    </div>
                    <span className="ib-tag" style={{ borderColor: cls.color, color: cls.color, fontSize: 8, fontWeight: 700 }}>
                      {cls.label}
                    </span>
                  </div>
                </Link>
                {/* Action buttons row */}
                <div style={{ display: "flex", gap: 6, padding: "0 14px 8px", justifyContent: "flex-end" }}>
                  <button
                    className="ib-btn"
                    style={{ fontSize: 9, padding: "3px 8px" }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); generateVideoInsight(v); }}
                    disabled={insightLoading === v.youtube_video_id}
                  >
                    {insightLoading === v.youtube_video_id ? "ANALYZING..." : insight ? "REFRESH INSIGHT" : "INSIGHT"}
                  </button>
                  <button
                    className="ib-btn"
                    style={{ fontSize: 9, padding: "3px 8px" }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); startAnalysis("video", v.youtube_video_id); }}
                  >
                    ANALYZE
                  </button>
                </div>
                {insight && (
                  <div style={{ margin: "0 14px 10px", padding: "8px 12px", background: "var(--ib-bg)", border: "1px solid var(--ib-border)", fontSize: 11, color: "var(--ib-text)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {insight}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Top Videos */}
      {activeTab === "top" && (
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>All-Time Top Videos</h3>
          </div>
          <table className="ib-table">
            <thead>
              <tr><th style={{ width: 30 }}>#</th><th></th><th>Title</th><th>Views</th><th>Retention</th><th>Watch Hours</th><th>Net Subs</th><th>Shares</th></tr>
            </thead>
            <tbody>
              {topVideos.map((v, i) => (
                <tr key={v.youtube_video_id}>
                  <td style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-text-dim)" }}>{i + 1}</td>
                  <td style={{ width: 80, padding: "4px 8px" }}>
                    <img src={`https://i.ytimg.com/vi/${v.youtube_video_id}/mqdefault.jpg`} alt="" width={80} height={45} style={{ objectFit: "cover", borderRadius: 2 }} loading="lazy" />
                  </td>
                  <td>
                    <Link href={`/ideation/analytics/${v.youtube_video_id}`} style={{ color: "var(--ib-text)", textDecoration: "none", fontSize: 12 }}>
                      {v.title}
                    </Link>
                    <div className="ib-meta">{ago(v.published_at)}</div>
                  </td>
                  <td style={{ fontFamily: "var(--ib-mono)", fontSize: 13, fontWeight: 600, color: "var(--ib-highlight)" }}>{fmtNum(v.views)}</td>
                  <td style={{ fontFamily: "var(--ib-mono)", color: (v.average_view_percentage ?? 0) > 40 ? "var(--ib-positive-text)" : "var(--ib-text-dim)" }}>{fmtPct(v.average_view_percentage)}</td>
                  <td style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-text-dim)" }}>{fmtHours(v.estimated_minutes_watched)}</td>
                  <td style={{ fontFamily: "var(--ib-mono)", color: (v.net_subscribers ?? 0) > 0 ? "var(--ib-positive-text)" : "var(--ib-text-dim)" }}>
                    {(v.net_subscribers ?? 0) > 0 ? "+" : ""}{fmtNum(v.net_subscribers)}
                  </td>
                  <td style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-text-dim)" }}>{fmtNum(v.shares)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Traffic Sources */}
      {activeTab === "traffic" && breakdowns && (
        <div className="ib-grid-2">
          <div className="ib-panel">
            <div className="ib-panel-head"><h3>Traffic Sources</h3></div>
            <table className="ib-table">
              <thead><tr><th>Source</th><th>Views</th><th>Watch Hours</th></tr></thead>
              <tbody>
                {breakdowns.traffic.sort((a, b) => b.views - a.views).map(t => (
                  <tr key={t.source}>
                    <td style={{ color: "var(--ib-text)" }}>{t.source}</td>
                    <td style={{ fontFamily: "var(--ib-mono)" }}>{fmtNum(t.views)}</td>
                    <td style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-text-dim)" }}>{fmtHours(t.estimated_minutes_watched)}</td>
                  </tr>
                ))}
                {breakdowns.traffic.length === 0 && <tr><td colSpan={3} className="ib-meta" style={{ textAlign: "center", padding: 20 }}>No traffic data</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="ib-panel">
            <div className="ib-panel-head"><h3>Geography (Top 10)</h3></div>
            <table className="ib-table">
              <thead><tr><th>Country</th><th>Views</th><th>Watch Hours</th></tr></thead>
              <tbody>
                {breakdowns.geography.sort((a, b) => b.views - a.views).slice(0, 10).map(g => (
                  <tr key={g.country}>
                    <td style={{ color: "var(--ib-text)" }}>{g.country}</td>
                    <td style={{ fontFamily: "var(--ib-mono)" }}>{fmtNum(g.views)}</td>
                    <td style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-text-dim)" }}>{fmtHours(g.estimated_minutes_watched)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audience Demographics */}
      {activeTab === "audience" && breakdowns && (
        <div className="ib-panel">
          <div className="ib-panel-head"><h3>Audience Demographics</h3></div>
          <table className="ib-table">
            <thead><tr><th>Age Group</th><th>Gender</th><th>Viewer %</th><th></th></tr></thead>
            <tbody>
              {breakdowns.demographics.sort((a, b) => b.viewer_percentage - a.viewer_percentage).map((d, i) => (
                <tr key={i}>
                  <td style={{ color: "var(--ib-text)" }}>{d.age_group}</td>
                  <td style={{ color: "var(--ib-text-dim)" }}>{d.gender}</td>
                  <td style={{ fontFamily: "var(--ib-mono)", fontWeight: 600 }}>{d.viewer_percentage.toFixed(1)}%</td>
                  <td style={{ width: 120 }}>
                    <div style={{ height: 6, background: "var(--ib-border)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(d.viewer_percentage * 4, 100)}%`, background: d.viewer_percentage > 10 ? "var(--ib-positive-text)" : "var(--ib-text-dim)", borderRadius: 2 }} />
                    </div>
                  </td>
                </tr>
              ))}
              {breakdowns.demographics.length === 0 && <tr><td colSpan={4} className="ib-meta" style={{ textAlign: "center", padding: 20 }}>No demographic data</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Chat Panel */}
      {chatOpen && (
        <div style={{ position: "fixed", bottom: 0, right: 0, width: 420, height: 500, background: "#0a0a0a", border: "1px solid #222", borderBottom: "none", display: "flex", flexDirection: "column", zIndex: 100, fontFamily: "var(--ib-mono)" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #222", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#111", flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#ccc", letterSpacing: 1 }}>MOON ANALYTICS AI</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {chatMessages.length > 0 && (
                <button onClick={() => updateChat([])} style={{ background: "none", border: "1px solid #222", color: "#555", cursor: "pointer", fontSize: 9, padding: "2px 6px", fontFamily: "inherit" }}>CLEAR</button>
              )}
              <button onClick={() => setChatOpen(false)} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14 }}>&times;</button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {chatMessages.length === 0 && (
              <div style={{ color: "#444", fontSize: 11, lineHeight: 1.6 }}>
                Ask me anything about Moon&apos;s channel performance. I can look up video stats, compare performance, analyze comments, check traffic sources, and more.
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                  {["Which video performed best this month?", "Why did the CIA Podcasts video do well?", "What are our top traffic sources?", "Compare our last 5 videos"].map(q => (
                    <button key={q} onClick={() => { setChatInput(q); }} style={{ textAlign: "left", background: "#151515", border: "1px solid #222", color: "#888", padding: "6px 10px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: m.role === "user" ? "85%" : "100%", padding: "8px 12px", background: m.role === "user" ? "#1a2a1e" : "#111", border: "1px solid", borderColor: m.role === "user" ? "#2a3a2e" : "#1a1a1a", fontSize: 12, color: m.role === "user" ? "#aaa" : "#999", lineHeight: 1.6 }}>
                {m.role === "user" ? m.content : <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />}
              </div>
            ))}
            {chatLoading && (
              <div style={{ color: "#5b9", fontSize: 11, padding: "8px 12px" }}>Analyzing...</div>
            )}
          </div>
          <div style={{ padding: "10px 14px", borderTop: "1px solid #222", display: "flex", gap: 8, flexShrink: 0 }}>
            <input
              style={{ flex: 1, background: "#111", border: "1px solid #222", color: "#ccc", padding: "8px 10px", fontSize: 12, fontFamily: "inherit", outline: "none" }}
              placeholder="Ask about your channel stats..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendChat()}
            />
            <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{ background: "#5b9", border: "none", color: "#000", padding: "8px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: chatLoading || !chatInput.trim() ? 0.5 : 1 }}>
              SEND
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
