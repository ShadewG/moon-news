"use client";

import { useCallback, useEffect, useState } from "react";

import { ideationGet, fmtNum, fmtScore } from "@/lib/ideation-client";
import type { TrendClusterRead } from "@/lib/ideation-types";

type Window = "24h" | "7d" | "30d" | "overall";
const WINDOWS: Window[] = ["24h", "7d", "30d", "overall"];

export default function TrendsTab() {
  const [window, setWindow] = useState<Window>("7d");
  const [trends, setTrends] = useState<TrendClusterRead[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (w: Window) => {
    setLoading(true);
    const data = await ideationGet<TrendClusterRead[]>(`/dashboard/trends?window=${w}&limit=20&exclude_news_sources=true`);
    if (data) setTrends(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(window); }, [window, load]);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div className="ib-window-tabs">
          {WINDOWS.map((w) => (
            <button key={w} className={w === window ? "active" : ""} onClick={() => setWindow(w)}>{w.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {loading && <div className="ib-meta" style={{ padding: 12 }}>Loading...</div>}

      {trends.map((t, i) => (
        <div key={i} className="ib-panel" style={{ marginBottom: 10 }}>
          <div className="ib-panel-head">
            <h3 style={{ textTransform: "none", letterSpacing: 0, fontSize: 12, color: "var(--ib-text-bright)" }}>{t.label}</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="ib-tag" style={{
                borderColor: t.heat === "hot" ? "var(--ib-hot)" : t.heat === "warm" ? "var(--ib-warm)" : "var(--ib-cool)",
                color: t.heat === "hot" ? "var(--ib-hot)" : t.heat === "warm" ? "var(--ib-warm)" : "var(--ib-cool)",
              }}>{t.heat}</span>
              <span className="ib-meta">{t.video_count} videos · {t.channel_count} ch · {fmtScore(t.avg_outlier_score)} avg</span>
            </div>
          </div>
          <div style={{ padding: "10px 14px" }}>
            <div style={{ fontSize: 12, color: "var(--ib-text)", marginBottom: 8, lineHeight: 1.5 }}>{t.description}</div>
            {t.top_videos.length > 0 && (
              <table className="ib-table" style={{ marginTop: 4 }}>
                <tbody>
                  {t.top_videos.slice(0, 5).map((v) => (
                    <tr key={v.youtube_video_id}>
                      <td style={{ width: 40, padding: "3px 6px" }}>
                        <img src={`https://i.ytimg.com/vi/${v.youtube_video_id}/mqdefault.jpg`} alt="" width={40} height={23} style={{ display: "block", objectFit: "cover" }} loading="lazy" />
                      </td>
                      <td style={{ fontSize: 11 }}>
                        <a href={`https://www.youtube.com/watch?v=${v.youtube_video_id}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ib-text)", textDecoration: "none" }}>{v.title}</a>
                      </td>
                      <td style={{ fontSize: 10, color: "var(--ib-text-dim)" }}>{v.channel_title}</td>
                      <td style={{ fontFamily: "var(--ib-mono)", fontSize: 10 }}>{fmtNum(v.latest_view_count)}</td>
                      <td style={{ fontFamily: "var(--ib-mono)", fontSize: 10, fontWeight: 600 }}>{fmtScore(v.external_outlier_score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ))}

      {trends.length === 0 && !loading && (
        <div className="ib-panel" style={{ padding: 30, textAlign: "center" }}>
          <div className="ib-meta">No trend clusters detected in this window.</div>
        </div>
      )}
    </div>
  );
}
