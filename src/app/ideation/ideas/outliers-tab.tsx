"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ideationGet, ideationPost, fmtNum, fmtScore, fmtDuration, timeAgo, ytThumb } from "@/lib/ideation-client";
import type { OutlierVideoRead, WatchlistChannelRead } from "@/lib/ideation-types";

type Window = "24h" | "7d" | "30d" | "overall";
const WINDOWS: Window[] = ["24h", "7d", "30d", "overall"];

export default function OutliersTab({ channels }: { channels: WatchlistChannelRead[] }) {
  const searchParams = useSearchParams();
  const initChannel = searchParams.get("channel");

  const [window, setWindow] = useState<Window>("7d");
  const [outliers, setOutliers] = useState<OutlierVideoRead[]>([]);
  const [channelFilter, setChannelFilter] = useState(initChannel || "");
  const [channelSearch, setChannelSearch] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [videoUrl, setVideoUrl] = useState("");
  const [addStatus, setAddStatus] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);

  const filteredChannels = useMemo(() => {
    const q = channelSearch.toLowerCase();
    return (q ? channels.filter((c) => c.title.toLowerCase().includes(q)) : channels).slice(0, 20);
  }, [channels, channelSearch]);

  const buildUrl = useCallback((off: number) => {
    let url = `/outliers?window=${window}&limit=50&offset=${off}&positive_only=true&exclude_categories=news,politics,geopolitics&exclude_news_sources=true`;
    if (channelFilter) url += `&channel_id=${channelFilter}`;
    return url;
  }, [window, channelFilter]);

  const load = useCallback(async (reset = true) => {
    setLoading(true);
    const off = reset ? 0 : offset;
    const data = await ideationGet<OutlierVideoRead[]>(buildUrl(off));
    if (data) {
      if (reset) { setOutliers(data); setOffset(data.length); }
      else { setOutliers((p) => [...p, ...data]); setOffset((p) => p + data.length); }
      setHasMore(data.length === 50);
    }
    setLoading(false);
  }, [buildUrl, offset]);

  useEffect(() => { load(true); }, [window, channelFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting && !loading) load(false); }, { rootMargin: "400px" });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function quickAdd() {
    if (!videoUrl.trim()) return;
    setAddStatus("Adding...");
    const res = await ideationPost("/videos/quick-add", { url: videoUrl.trim() });
    if (res) { setAddStatus("Added!"); setVideoUrl(""); load(true); }
    else setAddStatus("Failed");
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="ib-window-tabs">
          {WINDOWS.map((w) => (
            <button key={w} className={w === window ? "active" : ""} onClick={() => setWindow(w)}>{w.toUpperCase()}</button>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <input className="ib-input" style={{ width: 180 }} placeholder="Filter channel..." value={channelSearch}
            onChange={(e) => { setChannelSearch(e.target.value); setShowDrop(true); }}
            onFocus={() => setShowDrop(true)} onBlur={() => setTimeout(() => setShowDrop(false), 150)} />
          {showDrop && (
            <div style={{ position: "absolute", top: "100%", left: 0, width: 240, background: "var(--ib-surface)", border: "1px solid var(--ib-border)", zIndex: 50, maxHeight: 200, overflowY: "auto" }}>
              <div style={{ padding: "4px 8px", cursor: "pointer", color: "var(--ib-text-dim)", fontSize: 11 }}
                onMouseDown={() => { setChannelFilter(""); setChannelSearch(""); setShowDrop(false); }}>All channels</div>
              {filteredChannels.map((ch) => (
                <div key={ch.id} style={{ padding: "4px 8px", cursor: "pointer", fontSize: 11, color: "var(--ib-text)" }}
                  onMouseDown={() => { setChannelFilter(String(ch.id)); setChannelSearch(ch.title); setShowDrop(false); }}>{ch.title}</div>
              ))}
            </div>
          )}
        </div>
        <input className="ib-input" style={{ width: 220 }} placeholder="Add video URL..." value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} />
        <button className="ib-btn" onClick={quickAdd}>ADD</button>
        {addStatus && <span className="ib-meta">{addStatus}</span>}
      </div>

      <table className="ib-table">
        <thead>
          <tr><th style={{ width: 48 }}></th><th>Video</th><th>Channel</th><th>Category</th><th>Length</th><th>Views</th><th>Score</th><th>Age</th></tr>
        </thead>
        <tbody>
          {outliers.map((o) => (
            <tr key={o.video_id}>
              <td style={{ padding: "4px 8px" }}><img src={ytThumb(o.youtube_video_id)} alt="" width={48} height={27} style={{ display: "block", objectFit: "cover" }} loading="lazy" /></td>
              <td><a href={`https://www.youtube.com/watch?v=${o.youtube_video_id}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ib-text)", textDecoration: "none", fontSize: 12 }}>{o.title}</a></td>
              <td style={{ color: "var(--ib-text-dim)", fontSize: 11 }}>{o.channel_title}</td>
              <td><span className="ib-tag">{o.video_category_label || o.channel_category_label}</span></td>
              <td style={{ fontFamily: "var(--ib-mono)", fontSize: 11, color: "var(--ib-text-dim)" }}>{fmtDuration(o.duration_seconds)}</td>
              <td style={{ fontFamily: "var(--ib-mono)", fontSize: 11 }}>{fmtNum(o.latest_view_count)}</td>
              <td style={{ fontFamily: "var(--ib-mono)", fontSize: 12, fontWeight: 600, color: o.external_outlier_score >= 5 ? "var(--ib-highlight)" : o.external_outlier_score >= 2 ? "var(--ib-text-bright)" : "var(--ib-text-dim)" }}>{fmtScore(o.external_outlier_score)}</td>
              <td style={{ fontFamily: "var(--ib-mono)", fontSize: 10, color: "var(--ib-text-dim)" }}>{timeAgo(o.published_at)}</td>
            </tr>
          ))}
          {outliers.length === 0 && !loading && <tr><td colSpan={8} style={{ textAlign: "center", padding: 30, color: "var(--ib-text-dim)" }}>No outliers found</td></tr>}
        </tbody>
      </table>
      {loading && <div className="ib-meta" style={{ padding: 12, textAlign: "center" }}>Loading...</div>}
      <div ref={sentinelRef} />
    </div>
  );
}
