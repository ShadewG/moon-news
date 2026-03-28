"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ideationGet, fmtNum, fmtDuration, timeAgo, ytThumb } from "@/lib/ideation-client";
import type { VideoListResponse, WatchlistChannelRead } from "@/lib/ideation-types";

type Window = "24h" | "7d" | "30d";
const WINDOWS: Window[] = ["24h", "7d", "30d"];

export default function VideosTab({ channels }: { channels: WatchlistChannelRead[] }) {
  const [window, setWindow] = useState<Window>("30d");
  const [data, setData] = useState<VideoListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [channelFilter, setChannelFilter] = useState("");
  const [channelSearch, setChannelSearch] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const [loading, setLoading] = useState(false);

  const filteredChannels = useMemo(() => {
    const q = channelSearch.toLowerCase();
    return (q ? channels.filter((c) => c.title.toLowerCase().includes(q)) : channels).slice(0, 20);
  }, [channels, channelSearch]);

  const load = useCallback(async () => {
    setLoading(true);
    let url = `/videos?page=${page}&page_size=50&window=${window}`;
    if (channelFilter) url += `&channel_id=${channelFilter}`;
    const res = await ideationGet<VideoListResponse>(url);
    if (res) setData(res);
    setLoading(false);
  }, [page, window, channelFilter]);

  useEffect(() => { load(); }, [load]);

  const totalPages = data ? Math.ceil(data.total / 50) : 0;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="ib-window-tabs">
          {WINDOWS.map((w) => (
            <button key={w} className={w === window ? "active" : ""} onClick={() => { setWindow(w); setPage(1); }}>{w.toUpperCase()}</button>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <input className="ib-input" style={{ width: 180 }} placeholder="Filter channel..." value={channelSearch}
            onChange={(e) => { setChannelSearch(e.target.value); setShowDrop(true); }}
            onFocus={() => setShowDrop(true)} onBlur={() => setTimeout(() => setShowDrop(false), 150)} />
          {showDrop && (
            <div style={{ position: "absolute", top: "100%", left: 0, width: 240, background: "var(--ib-surface)", border: "1px solid var(--ib-border)", zIndex: 50, maxHeight: 200, overflowY: "auto" }}>
              <div style={{ padding: "4px 8px", cursor: "pointer", color: "var(--ib-text-dim)", fontSize: 11 }}
                onMouseDown={() => { setChannelFilter(""); setChannelSearch(""); setShowDrop(false); setPage(1); }}>All channels</div>
              {filteredChannels.map((ch) => (
                <div key={ch.id} style={{ padding: "4px 8px", cursor: "pointer", fontSize: 11, color: "var(--ib-text)" }}
                  onMouseDown={() => { setChannelFilter(String(ch.id)); setChannelSearch(ch.title); setShowDrop(false); setPage(1); }}>{ch.title}</div>
              ))}
            </div>
          )}
        </div>
        <span className="ib-meta">{data ? `${data.total} videos` : ""}</span>
      </div>

      <table className="ib-table">
        <thead>
          <tr><th style={{ width: 120 }}></th><th>Video</th><th>Channel</th><th>Length</th><th>Views</th><th>Score</th><th>Age</th></tr>
        </thead>
        <tbody>
          {(data?.items ?? []).map((v) => (
            <tr key={v.id}>
              <td style={{ padding: "4px 8px" }}><img src={ytThumb(v.youtube_video_id)} alt="" width={120} height={68} style={{ display: "block", objectFit: "cover", borderRadius: 2 }} loading="lazy" /></td>
              <td><a href={`https://www.youtube.com/watch?v=${v.youtube_video_id}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ib-text)", textDecoration: "none", fontSize: 12 }}>{v.title}</a></td>
              <td style={{ color: "var(--ib-text-dim)", fontSize: 11 }}>{v.channel_title}</td>
              <td style={{ fontFamily: "var(--ib-mono)", fontSize: 11, color: "var(--ib-text-dim)" }}>{fmtDuration(v.duration_seconds)}</td>
              <td style={{ fontFamily: "var(--ib-mono)", fontSize: 11 }}>{fmtNum(v.latest_view_count)}</td>
              <td style={{ fontFamily: "var(--ib-mono)", fontSize: 11, fontWeight: 600 }}>{v.outlier_score != null ? v.outlier_score.toFixed(1) : "—"}</td>
              <td style={{ fontFamily: "var(--ib-mono)", fontSize: 10, color: "var(--ib-text-dim)" }}>{timeAgo(v.published_at)}</td>
            </tr>
          ))}
          {(!data || data.items.length === 0) && !loading && <tr><td colSpan={7} style={{ textAlign: "center", padding: 30, color: "var(--ib-text-dim)" }}>No videos found</td></tr>}
        </tbody>
      </table>

      {loading && <div className="ib-meta" style={{ padding: 12, textAlign: "center" }}>Loading...</div>}

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, justifyContent: "center" }}>
          <button className="ib-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>PREV</button>
          <span className="ib-meta">Page {page} of {totalPages}</span>
          <button className="ib-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>NEXT</button>
        </div>
      )}
    </div>
  );
}
