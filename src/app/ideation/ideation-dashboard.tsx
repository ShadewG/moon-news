"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ideationGet, fmtNum } from "@/lib/ideation-client";
import type { DashboardSummary, TrendClusterRead } from "@/lib/ideation-types";

type Window = "7d" | "30d" | "overall";

const WINDOWS: Window[] = ["7d", "30d", "overall"];

export default function IdeationDashboard({
  initialSummary,
  initialTrends,
}: {
  initialSummary: DashboardSummary | null;
  initialTrends: TrendClusterRead[] | null;
}) {
  const router = useRouter();
  const [window, setWindow] = useState<Window>("30d");
  const [summary, setSummary] = useState(initialSummary);
  const [trends, setTrends] = useState(initialTrends ?? []);

  // Legacy hash redirects
  useEffect(() => {
    const hash = globalThis.location?.hash;
    if (!hash) return;
    const h = hash.replace("#", "");
    if (h === "ideas" || h === "outliers" || h === "trends" || h === "videos" || h === "archive") {
      router.replace(`/ideation/ideas${h !== "ideas" ? `?tab=${h}` : ""}`);
    } else if (h === "research" || h === "library" || h === "watchlist") {
      router.replace(`/ideation/${h === "library" ? "watchlist" : h}`);
    } else if (h === "settings") {
      router.replace("/ideation/settings");
    } else if (h.startsWith("research-")) {
      router.replace(`/ideation/research/${h.replace("research-", "")}`);
    } else if (h.startsWith("outline-")) {
      const parts = h.replace("outline-", "").split("-");
      const source = parts[0];
      const id = parts.slice(1).join("-");
      router.replace(`/ideation/outlines/${source}/${id}`);
    } else if (h.startsWith("channel-")) {
      router.replace(`/ideation/ideas?tab=outliers&channel=${h.replace("channel-", "")}`);
    } else if (h.startsWith("idea-")) {
      router.replace(`/ideation/ideas?highlight=${h.replace("idea-", "")}`);
    }
  }, [router]);

  const refresh = useCallback(async (w: Window) => {
    const [s, t] = await Promise.all([
      ideationGet<DashboardSummary>(`/dashboard/summary?window=${w}`),
      ideationGet<TrendClusterRead[]>(`/dashboard/trends?window=${w}&limit=8&exclude_news_sources=true`),
    ]);
    if (s) setSummary(s);
    if (t) setTrends(t);
  }, []);

  // Refresh on window change
  useEffect(() => {
    refresh(window);
  }, [window, refresh]);

  // Poll every 60s
  useEffect(() => {
    const id = setInterval(() => refresh(window), 60_000);
    return () => clearInterval(id);
  }, [window, refresh]);

  return (
    <div>
      <div className="ib-page-header">
        <h2>Dashboard</h2>
        <div className="ib-window-tabs">
          {WINDOWS.map((w) => (
            <button key={w} className={w === window ? "active" : ""} onClick={() => setWindow(w)}>
              {w.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Stat row */}
      <div className="ib-stat-row">
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Channels</div>
          <div className="ib-stat-value">{summary?.monitored_channels ?? "—"}</div>
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Total Videos</div>
          <div className="ib-stat-value">{fmtNum(summary?.observed_videos)}</div>
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Recent Videos</div>
          <div className="ib-stat-value">{fmtNum(summary?.recent_videos)}</div>
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Outliers</div>
          <div className="ib-stat-value">{summary?.ranked_outliers ?? "—"}</div>
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Active</div>
          <div className="ib-stat-value">{summary?.active_channels ?? "—"}</div>
        </div>
      </div>

      <div className="ib-grid-2">
        {/* Top Channels */}
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>Top Channels</h3>
            <Link href="/ideation/watchlist" className="ib-panel-link">ALL &rarr;</Link>
          </div>
          <table className="ib-table">
            <thead>
              <tr><th>#</th><th>Channel</th><th>Videos</th></tr>
            </thead>
            <tbody>
              {(summary?.top_channels ?? []).map((ch, i) => (
                <tr key={ch.channel_id}>
                  <td style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-text-dim)" }}>{i + 1}</td>
                  <td style={{ color: "var(--ib-text)" }}>{ch.title}</td>
                  <td style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-text-dim)" }}>{ch.video_count}</td>
                </tr>
              ))}
              {(!summary?.top_channels || summary.top_channels.length === 0) && (
                <tr><td colSpan={3} style={{ color: "var(--ib-text-dim)", textAlign: "center", padding: 20 }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Hottest Clusters */}
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>Active Clusters</h3>
            <Link href="/ideation/ideas?tab=trends" className="ib-panel-link">ALL &rarr;</Link>
          </div>
          <div style={{ padding: 14 }}>
            {trends.length === 0 && (
              <div className="ib-meta">No trends detected in this window.</div>
            )}
            {trends.slice(0, 6).map((t, i) => (
              <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid var(--ib-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--ib-text-bright)", fontSize: 12 }}>{t.label}</span>
                  <span className="ib-tag" style={{
                    borderColor: t.heat === "hot" ? "var(--ib-hot)" : t.heat === "warm" ? "var(--ib-warm)" : "var(--ib-cool)",
                    color: t.heat === "hot" ? "var(--ib-hot)" : t.heat === "warm" ? "var(--ib-warm)" : "var(--ib-cool)",
                  }}>
                    {t.heat}
                  </span>
                </div>
                <div className="ib-meta" style={{ marginTop: 2 }}>
                  {t.video_count} videos · {t.channel_count} channels · {t.avg_outlier_score.toFixed(1)} avg score
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
