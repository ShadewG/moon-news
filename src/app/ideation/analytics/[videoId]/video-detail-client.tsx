"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtNum } from "@/lib/ideation-client";

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

interface RetentionPoint {
  elapsedVideoTimeRatio: number;
  audienceWatchRatio: number;
  relativeRetentionPerformance: number;
}

interface Comment {
  author: string;
  text: string;
  likes: number;
  reply_count: number;
  published_at: string;
  replies?: Array<{ author: string; text: string; likes: number; published_at: string }>;
}

interface DeepInsight {
  summary: string;
  whatWorked: string;
  whatDidnt: string;
  audienceReaction: string;
  recommendation: string;
}

function fmtPct(n: number | null | undefined): string {
  return n != null ? n.toFixed(1) + "%" : "\u2014";
}
function fmtDur(secs: number | null | undefined): string {
  if (!secs) return "\u2014";
  const m = Math.floor(secs / 60), s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtDate(d: string | null): string {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function RetentionChart({ points, durationSeconds }: { points: RetentionPoint[]; durationSeconds: number | null }) {
  if (points.length === 0) return <div className="ib-meta" style={{ padding: 20, textAlign: "center" }}>No retention data available (YouTube Analytics reports with a 2-3 day delay)</div>;

  const w = 700, h = 180, pad = { t: 10, r: 10, b: 30, l: 45 };
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;

  const maxY = Math.max(...points.map(p => p.audienceWatchRatio), 1);
  const toX = (r: number) => pad.l + r * plotW;
  const toY = (v: number) => pad.t + plotH - (v / maxY) * plotH;

  const mainPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.elapsedVideoTimeRatio).toFixed(1)},${toY(p.audienceWatchRatio).toFixed(1)}`).join(" ");
  const relPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.elapsedVideoTimeRatio).toFixed(1)},${toY(p.relativeRetentionPerformance).toFixed(1)}`).join(" ");

  const biggest_drop_idx = points.reduce((worst, p, i) => {
    if (i === 0) return worst;
    const drop = points[i - 1].audienceWatchRatio - p.audienceWatchRatio;
    return drop > (worst.drop ?? 0) ? { idx: i, drop } : worst;
  }, { idx: 0, drop: 0 });

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={w} height={h} style={{ display: "block", fontFamily: "var(--ib-mono)", fontSize: 9, fill: "#444" }}>
        {[0, 0.25, 0.5, 0.75, 1].map(r => (
          <g key={r}>
            <line x1={pad.l} y1={toY(r * maxY)} x2={w - pad.r} y2={toY(r * maxY)} stroke="#1a1a1a" />
            <text x={pad.l - 4} y={toY(r * maxY) + 3} textAnchor="end">{(r * 100).toFixed(0)}%</text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map(r => {
          const secs = durationSeconds ? Math.round(r * durationSeconds) : 0;
          const label = durationSeconds ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : `${(r * 100).toFixed(0)}%`;
          return <text key={r} x={toX(r)} y={h - 5} textAnchor="middle">{label}</text>;
        })}
        <path d={relPath} fill="none" stroke="#334" strokeWidth={1.5} strokeDasharray="4 3" />
        <path d={mainPath} fill="none" stroke="#5b9" strokeWidth={2} />
        {biggest_drop_idx.idx > 0 && biggest_drop_idx.drop > 0.03 && (
          <circle cx={toX(points[biggest_drop_idx.idx].elapsedVideoTimeRatio)} cy={toY(points[biggest_drop_idx.idx].audienceWatchRatio)} r={4} fill="#a44" stroke="#0a0a0a" strokeWidth={1.5} />
        )}
        <line x1={pad.l + 10} y1={pad.t + 6} x2={pad.l + 30} y2={pad.t + 6} stroke="#5b9" strokeWidth={2} />
        <text x={pad.l + 34} y={pad.t + 9}>Audience</text>
        <line x1={pad.l + 100} y1={pad.t + 6} x2={pad.l + 120} y2={pad.t + 6} stroke="#334" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={pad.l + 124} y={pad.t + 9}>vs Similar</text>
      </svg>
    </div>
  );
}

function parseDeepInsight(raw: string): DeepInsight | null {
  // Try to parse structured sections from the AI response
  const sections: DeepInsight = {
    summary: "",
    whatWorked: "",
    whatDidnt: "",
    audienceReaction: "",
    recommendation: "",
  };

  // Match section patterns like "## Summary" or "**Summary:**" or "Summary:" etc.
  const sectionPatterns = [
    { key: "summary" as const, patterns: [/(?:#{1,3}\s*)?(?:\*\*)?summary(?:\*\*)?:?\s*/i] },
    { key: "whatWorked" as const, patterns: [/(?:#{1,3}\s*)?(?:\*\*)?what\s*worked(?:\*\*)?:?\s*/i, /(?:#{1,3}\s*)?(?:\*\*)?strengths(?:\*\*)?:?\s*/i] },
    { key: "whatDidnt" as const, patterns: [/(?:#{1,3}\s*)?(?:\*\*)?what\s*didn'?t(?:\s*work)?(?:\*\*)?:?\s*/i, /(?:#{1,3}\s*)?(?:\*\*)?weaknesses(?:\*\*)?:?\s*/i, /(?:#{1,3}\s*)?(?:\*\*)?areas?\s*(?:for\s*)?improvement(?:\*\*)?:?\s*/i] },
    { key: "audienceReaction" as const, patterns: [/(?:#{1,3}\s*)?(?:\*\*)?audience\s*reaction(?:\*\*)?:?\s*/i, /(?:#{1,3}\s*)?(?:\*\*)?audience(?:\*\*)?:?\s*/i, /(?:#{1,3}\s*)?(?:\*\*)?comments?\s*(?:analysis)?(?:\*\*)?:?\s*/i] },
    { key: "recommendation" as const, patterns: [/(?:#{1,3}\s*)?(?:\*\*)?recommendation(?:s)?(?:\*\*)?:?\s*/i, /(?:#{1,3}\s*)?(?:\*\*)?action\s*items?(?:\*\*)?:?\s*/i, /(?:#{1,3}\s*)?(?:\*\*)?next\s*steps?(?:\*\*)?:?\s*/i] },
  ];

  // Try to split by recognizable headings
  const lines = raw.split("\n");
  let currentSection: keyof DeepInsight | null = null;
  let buffer: string[] = [];

  for (const line of lines) {
    let matchedSection: keyof DeepInsight | null = null;
    for (const { key, patterns } of sectionPatterns) {
      for (const p of patterns) {
        if (p.test(line)) {
          matchedSection = key;
          break;
        }
      }
      if (matchedSection) break;
    }

    if (matchedSection) {
      if (currentSection && buffer.length > 0) {
        sections[currentSection] = buffer.join("\n").trim();
      }
      currentSection = matchedSection;
      buffer = [line.replace(sectionPatterns.find(s => s.key === matchedSection)!.patterns[0], "").trim()].filter(Boolean);
    } else {
      buffer.push(line);
    }
  }
  if (currentSection && buffer.length > 0) {
    sections[currentSection] = buffer.join("\n").trim();
  }

  // If we didn't parse any sections, return null and show raw text
  const filledSections = Object.values(sections).filter(v => v.length > 0).length;
  if (filledSections < 2) return null;

  // Fill missing summary with first portion
  if (!sections.summary && raw.length > 0) {
    sections.summary = raw.split("\n").slice(0, 3).join("\n").trim();
  }

  return sections;
}

interface AnalysisReport {
  title: string;
  dek: string;
  summary: string;
  pills: string[];
  keyTakeaways: string[];
  numbersThatMatter: Array<{ label: string; value: string; note: string }>;
  transcriptFindings: Array<{ heading: string; body: string }>;
  retentionFindings: Array<{ heading: string; body: string }>;
  targetDiagnosis: { title: string; summary: string; bullets: string[] } | null;
  winnerPatterns: Array<{ heading: string; body: string }>;
  ideaDirections: Array<{ title: string; whyNow: string; evidence: string }>;
  footerNote: string;
}

export default function VideoDetailClient({
  video, retention, comments, recentVideos, analysisReport, analysisRunId,
}: {
  video: VideoAnalytics;
  retention: RetentionPoint[];
  comments: Comment[];
  recentVideos: VideoAnalytics[];
  analysisReport?: AnalysisReport | null;
  analysisRunId?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<"retention" | "comments" | "compare" | "similar" | "analysis" | "lifecycle">(
    analysisReport ? "analysis" : "retention"
  );
  const [deepInsight, setDeepInsight] = useState<string | null>(null);
  const [parsedInsight, setParsedInsight] = useState<DeepInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  // Lifecycle tracking (Feature 3)
  const [lifecycleSnapshots, setLifecycleSnapshots] = useState<Array<{ collected_at: string; video_age_hours: number; view_count: number; like_count: number; comment_count: number }>>([]);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  // Comment sentiment analysis (Feature 4)
  const [sentimentData, setSentimentData] = useState<{ sentiment: string; sentimentScore: number; themes: string[]; keyFeedback: string[]; summary: string } | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [similarVideos, setSimilarVideos] = useState<VideoAnalytics[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);

  const avgViews = recentVideos.reduce((s, v) => s + (v.views ?? 0), 0) / (recentVideos.length || 1);
  const perf = (video.views ?? 0) > avgViews * 1.3 ? "above" : (video.views ?? 0) < avgViews * 0.7 ? "below" : "around";

  // Extract keywords from title for similar video search
  const titleKeywords = useMemo(() => {
    const stopWords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from", "is", "it", "its", "this", "that", "was", "are", "were", "be", "been", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "how", "why", "what", "when", "where", "who", "which"]);
    return video.title
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()))
      .map(w => w.toLowerCase())
      .slice(0, 5);
  }, [video.title]);

  // Find similar videos from recent videos by matching title keywords
  useEffect(() => {
    if (titleKeywords.length === 0) return;
    setSimilarLoading(true);

    // Score each recent video by keyword overlap
    const scored = recentVideos
      .filter(v => v.youtube_video_id !== video.youtube_video_id)
      .map(v => {
        const titleLower = v.title.toLowerCase();
        const hits = titleKeywords.filter(k => titleLower.includes(k)).length;
        return { video: v, score: hits };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(s => s.video);

    setSimilarVideos(scored);
    setSimilarLoading(false);
  }, [titleKeywords, recentVideos, video.youtube_video_id]);

  // Fetch lifecycle snapshots when LIFECYCLE tab is active (Feature 3)
  useEffect(() => {
    if (activeTab !== "lifecycle") return;
    if (lifecycleSnapshots.length > 0) return;
    let cancelled = false;
    setLifecycleLoading(true);
    fetch(`/api/ideation/videos/${video.youtube_video_id}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        setLifecycleSnapshots(data.snapshots ?? []);
        setLifecycleLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLifecycleLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeTab, video.youtube_video_id, lifecycleSnapshots.length]);

  // Comment sentiment analysis (Feature 4)
  const analyzeSentiment = useCallback(async () => {
    if (comments.length === 0) return;
    setSentimentLoading(true);
    try {
      const res = await fetch("/api/ideation/analytics/ai-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commentAnalysis: true,
          title: video.title,
          comments: comments.slice(0, 20).map(c => c.text),
        }),
      });
      const data = await res.json();
      const raw = data.insight ?? data.error ?? "";
      // Try to parse JSON from the response
      try {
        const parsed = JSON.parse(raw);
        setSentimentData(parsed);
      } catch {
        // If not valid JSON, try to extract from response
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            setSentimentData(JSON.parse(jsonMatch[0]));
          } catch {
            setSentimentData({ sentiment: "Unknown", sentimentScore: 50, themes: [], keyFeedback: [raw], summary: raw });
          }
        } else {
          setSentimentData({ sentiment: "Unknown", sentimentScore: 50, themes: [], keyFeedback: [raw], summary: raw });
        }
      }
    } catch {
      setSentimentData({ sentiment: "Error", sentimentScore: 0, themes: [], keyFeedback: ["Failed to analyze sentiment"], summary: "Analysis failed" });
    }
    setSentimentLoading(false);
  }, [comments, video.title]);

  const startAnalysis = useCallback(async (scope: "video" | "weekly") => {
    setAnalysisStatus("Starting...");
    try {
      const body: Record<string, unknown> = { scopeType: scope };
      if (scope === "video") body.youtubeVideoId = video.youtube_video_id;
      const res = await fetch("/api/moon-analysis/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.runId) {
        setAnalysisStatus("Analysis started");
        window.open(`/moon-analysis/${data.runId}`, "_blank");
      } else {
        setAnalysisStatus(data.error ?? "Failed");
      }
    } catch { setAnalysisStatus("Failed"); }
  }, [video.youtube_video_id]);

  const generateDeepInsight = useCallback(async () => {
    setInsightLoading(true);
    setDeepInsight(null);
    setParsedInsight(null);
    try {
      const res = await fetch("/api/ideation/analytics/ai-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: video.youtube_video_id,
          title: video.title,
          views: video.views,
          avgRetention: video.average_view_percentage,
          likes: video.likes,
          comments: video.comments,
          shares: video.shares,
          netSubs: video.net_subscribers,
          duration: video.duration_seconds,
          channelAvgViews: Math.round(avgViews),
          performance: perf,
          topComments: comments.slice(0, 8).map(c => c.text.slice(0, 150)),
          deepAnalysis: true,
        }),
      });
      const data = await res.json();
      const raw = data.insight ?? data.error ?? "No insight generated";
      setDeepInsight(raw);
      setParsedInsight(parseDeepInsight(raw));
    } catch {
      setDeepInsight("Failed to generate insight");
    }
    setInsightLoading(false);
  }, [video, avgViews, perf, comments]);

  return (
    <div>
      {/* Back link */}
      <Link href="/ideation/analytics" style={{ color: "var(--ib-text-dim)", textDecoration: "none", fontSize: 11, fontFamily: "var(--ib-mono)" }}>
        &larr; Moon Stats
      </Link>

      {/* YouTube Embed */}
      <div style={{ marginTop: 12, marginBottom: 20 }}>
        <div style={{ position: "relative", paddingBottom: "min(56.25%, 400px)", height: 0, maxWidth: 710, background: "#000", borderRadius: 2, overflow: "hidden" }}>
          <iframe
            src={`https://www.youtube.com/embed/${video.youtube_video_id}`}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={video.title}
          />
        </div>
      </div>

      {/* Header */}
      <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: "var(--ib-highlight)", margin: "0 0 8px", lineHeight: 1.3 }}>
            {video.title}
          </h2>
          <div className="ib-meta" style={{ marginBottom: 12 }}>
            {fmtDate(video.published_at)} &middot; {fmtDur(video.duration_seconds)}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <a href={`https://www.youtube.com/watch?v=${video.youtube_video_id}`} target="_blank" rel="noopener noreferrer" className="ib-btn">
              YOUTUBE &nearr;
            </a>
            <button className="ib-btn" onClick={() => startAnalysis("video")}>
              RUN DEEP ANALYSIS
            </button>
            {analysisStatus && <span className="ib-meta" style={{ alignSelf: "center" }}>{analysisStatus}</span>}
          </div>
        </div>
      </div>

      {/* Analytics pending banner */}
      {video.average_view_percentage == null && video.shares == null && (
        <div style={{ padding: "10px 14px", marginBottom: 12, background: "#1a1a0a", border: "1px solid #2a2a1a", fontSize: 11, color: "#b8a86a", fontFamily: "var(--ib-mono)" }}>
          YouTube Analytics data pending -- detailed stats (retention, subs, shares) take 2-3 days to appear. View count and basic data from real-time tracker shown below.
        </div>
      )}

      {/* Stats row */}
      <div className="ib-stat-row">
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Views</div>
          <div className="ib-stat-value">{fmtNum(video.views)}</div>
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Avg Retention</div>
          <div className="ib-stat-value" style={{ color: (video.average_view_percentage ?? 0) > 45 ? "var(--ib-positive-text)" : (video.average_view_percentage ?? 0) > 30 ? "var(--ib-warn-text)" : "var(--ib-negative-text)" }}>
            {fmtPct(video.average_view_percentage)}
          </div>
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Avg Watch Time</div>
          <div className="ib-stat-value">{fmtDur(video.average_view_duration_seconds)}</div>
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Net Subscribers</div>
          <div className="ib-stat-value" style={{ color: (video.net_subscribers ?? 0) > 0 ? "var(--ib-positive-text)" : "var(--ib-negative-text)" }}>
            {(video.net_subscribers ?? 0) > 0 ? "+" : ""}{fmtNum(video.net_subscribers)}
          </div>
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Likes</div>
          <div className="ib-stat-value">{fmtNum(video.likes)}</div>
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Comments</div>
          <div className="ib-stat-value">{fmtNum(video.comments)}</div>
        </div>
        <div className="ib-stat-cell">
          <div className="ib-stat-label">Shares</div>
          <div className="ib-stat-value">{fmtNum(video.shares)}</div>
        </div>
      </div>

      {/* Comparison to channel avg */}
      <div className="ib-panel" style={{ padding: "10px 14px", marginBottom: 16, display: "flex", gap: 16, alignItems: "center" }}>
        <span className="ib-meta">vs channel average ({fmtNum(Math.round(avgViews))} views):</span>
        <span style={{ fontFamily: "var(--ib-mono)", fontSize: 13, fontWeight: 600, color: perf === "above" ? "var(--ib-positive-text)" : perf === "below" ? "var(--ib-negative-text)" : "var(--ib-text-dim)" }}>
          {((video.views ?? 0) / (avgViews || 1) * 100).toFixed(0)}% of average
        </span>
        {video.estimated_minutes_watched && (
          <span className="ib-meta">{fmtNum(Math.round(video.estimated_minutes_watched / 60))} watch hours</span>
        )}
      </div>

      {/* Deep Insight Panel */}
      <div className="ib-panel" style={{ marginBottom: 16 }}>
        <div className="ib-panel-head">
          <h3>AI Deep Insight</h3>
          <button
            className="ib-btn ib-btn-primary"
            onClick={generateDeepInsight}
            disabled={insightLoading}
            style={{ fontSize: 10, padding: "6px 16px" }}
          >
            {insightLoading ? "ANALYZING..." : deepInsight ? "REGENERATE DEEP INSIGHT" : "GENERATE DEEP INSIGHT"}
          </button>
        </div>

        {insightLoading && (
          <div style={{ padding: 20, textAlign: "center" }}>
            <div style={{ fontFamily: "var(--ib-mono)", fontSize: 11, color: "var(--ib-positive-text)", marginBottom: 8 }}>
              Analyzing transcript, comments, and comparable videos...
            </div>
            <div style={{ width: 200, height: 3, background: "var(--ib-border)", margin: "0 auto", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "var(--ib-positive-text)", borderRadius: 2, animation: "insightPulse 1.5s ease-in-out infinite", width: "60%" }} />
            </div>
            <style>{`@keyframes insightPulse { 0%, 100% { opacity: 0.3; transform: translateX(-30%); } 50% { opacity: 1; transform: translateX(30%); } }`}</style>
          </div>
        )}

        {deepInsight && !insightLoading && parsedInsight && (
          <div style={{ padding: 0 }}>
            {/* Summary */}
            {parsedInsight.summary && (
              <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--ib-border)" }}>
                <div style={{ fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 1, color: "var(--ib-text-dim)", marginBottom: 6 }}>Summary</div>
                <div style={{ fontSize: 12, color: "var(--ib-text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{parsedInsight.summary}</div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
              {/* What Worked */}
              {parsedInsight.whatWorked && (
                <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--ib-border)", borderRight: "1px solid var(--ib-border)", background: "rgba(74,122,74,0.04)" }}>
                  <div style={{ fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 1, color: "var(--ib-positive-text)", marginBottom: 6 }}>What Worked</div>
                  <div style={{ fontSize: 11, color: "var(--ib-text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{parsedInsight.whatWorked}</div>
                </div>
              )}
              {/* What Didn't */}
              {parsedInsight.whatDidnt && (
                <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--ib-border)", background: "rgba(122,74,74,0.04)" }}>
                  <div style={{ fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 1, color: "var(--ib-negative-text)", marginBottom: 6 }}>What Didn&apos;t Work</div>
                  <div style={{ fontSize: 11, color: "var(--ib-text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{parsedInsight.whatDidnt}</div>
                </div>
              )}
            </div>
            {/* Audience Reaction */}
            {parsedInsight.audienceReaction && (
              <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--ib-border)" }}>
                <div style={{ fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 1, color: "var(--ib-cool)", marginBottom: 6 }}>Audience Reaction</div>
                <div style={{ fontSize: 11, color: "var(--ib-text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{parsedInsight.audienceReaction}</div>
              </div>
            )}
            {/* Recommendation */}
            {parsedInsight.recommendation && (
              <div style={{ padding: "12px 14px", background: "rgba(106,138,184,0.05)" }}>
                <div style={{ fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 1, color: "#b8a86a", marginBottom: 6 }}>Recommendation</div>
                <div style={{ fontSize: 11, color: "var(--ib-text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{parsedInsight.recommendation}</div>
              </div>
            )}
          </div>
        )}

        {deepInsight && !insightLoading && !parsedInsight && (
          <div style={{ padding: 14, fontSize: 12, color: "var(--ib-text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {deepInsight}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="ib-window-tabs" style={{ marginBottom: 16 }}>
        {(["analysis", "retention", "lifecycle", "comments", "similar", "compare"] as const).map(t => (
          <button key={t} className={activeTab === t ? "active" : ""} onClick={() => setActiveTab(t)}>
            {t === "analysis" ? "ANALYSIS" : t === "retention" ? "RETENTION CURVE" : t === "lifecycle" ? "LIFECYCLE" : t === "comments" ? `COMMENTS (${comments.length})` : t === "similar" ? `SIMILAR (${similarVideos.length})` : "COMPARE"}
          </button>
        ))}
      </div>

      {/* Analysis Report */}
      {activeTab === "analysis" && (
        analysisReport ? (
          <div>
            {/* Summary */}
            <div className="ib-panel" style={{ marginBottom: 12 }}>
              <div className="ib-panel-head">
                <h3>{analysisReport.title}</h3>
                {analysisReport.pills?.length > 0 && (
                  <div style={{ display: "flex", gap: 4 }}>
                    {analysisReport.pills.map((p, i) => <span key={i} className="ib-tag" style={{ borderColor: "var(--ib-positive)", color: "var(--ib-positive-text)" }}>{p}</span>)}
                  </div>
                )}
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ fontSize: 13, color: "var(--ib-text-bright)", marginBottom: 8, fontStyle: "italic" }}>{analysisReport.dek}</div>
                <div style={{ fontSize: 12, color: "var(--ib-text)", lineHeight: 1.7 }}>{analysisReport.summary}</div>
              </div>
            </div>

            {/* Key Takeaways */}
            {analysisReport.keyTakeaways?.length > 0 && (
              <div className="ib-panel" style={{ marginBottom: 12 }}>
                <div className="ib-panel-head"><h3>Key Takeaways</h3></div>
                <div style={{ padding: 14 }}>
                  {analysisReport.keyTakeaways.map((t, i) => (
                    <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid var(--ib-border)", fontSize: 12, color: "var(--ib-text)", lineHeight: 1.6, display: "flex", gap: 8 }}>
                      <span style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-positive-text)", flexShrink: 0, fontSize: 11 }}>{i + 1}.</span>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Numbers That Matter */}
            {analysisReport.numbersThatMatter?.length > 0 && (
              <div className="ib-stat-row" style={{ marginBottom: 12 }}>
                {analysisReport.numbersThatMatter.map((n, i) => (
                  <div key={i} className="ib-stat-cell">
                    <div className="ib-stat-label">{n.label}</div>
                    <div className="ib-stat-value" style={{ fontSize: 16 }}>{n.value}</div>
                    <div className="ib-meta" style={{ marginTop: 2 }}>{n.note}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Target Diagnosis */}
            {analysisReport.targetDiagnosis && (
              <div className="ib-panel" style={{ marginBottom: 12, borderLeftColor: "var(--ib-cool)", borderLeftWidth: 3 }}>
                <div className="ib-panel-head"><h3>{analysisReport.targetDiagnosis.title}</h3></div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 12, color: "var(--ib-text)", lineHeight: 1.6, marginBottom: 10 }}>{analysisReport.targetDiagnosis.summary}</div>
                  {analysisReport.targetDiagnosis.bullets.map((b, i) => (
                    <div key={i} style={{ padding: "4px 0 4px 12px", borderLeft: "2px solid var(--ib-border)", fontSize: 12, color: "var(--ib-text)", lineHeight: 1.5, marginBottom: 4 }}>{b}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="ib-grid-2" style={{ marginBottom: 12 }}>
              {/* Transcript Findings */}
              {analysisReport.transcriptFindings?.length > 0 && (
                <div className="ib-panel">
                  <div className="ib-panel-head"><h3>Transcript Findings</h3></div>
                  {analysisReport.transcriptFindings.map((f, i) => (
                    <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--ib-border)" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ib-text-bright)", marginBottom: 4 }}>{f.heading}</div>
                      <div style={{ fontSize: 11, color: "var(--ib-text)", lineHeight: 1.6 }}>{f.body}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Retention Findings */}
              {analysisReport.retentionFindings?.length > 0 && (
                <div className="ib-panel">
                  <div className="ib-panel-head"><h3>Retention Findings</h3></div>
                  {analysisReport.retentionFindings.map((f, i) => (
                    <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--ib-border)" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ib-text-bright)", marginBottom: 4 }}>{f.heading}</div>
                      <div style={{ fontSize: 11, color: "var(--ib-text)", lineHeight: 1.6 }}>{f.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Winner Patterns */}
            {analysisReport.winnerPatterns?.length > 0 && (
              <div className="ib-panel" style={{ marginBottom: 12 }}>
                <div className="ib-panel-head"><h3>Winner Patterns</h3></div>
                {analysisReport.winnerPatterns.map((p, i) => (
                  <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--ib-border)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ib-positive-text)", marginBottom: 4 }}>{p.heading}</div>
                    <div style={{ fontSize: 11, color: "var(--ib-text)", lineHeight: 1.6 }}>{p.body}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Idea Directions */}
            {analysisReport.ideaDirections?.length > 0 && (
              <div className="ib-panel" style={{ marginBottom: 12 }}>
                <div className="ib-panel-head"><h3>Idea Directions</h3></div>
                {analysisReport.ideaDirections.map((idea, i) => (
                  <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--ib-border)" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ib-text-bright)", marginBottom: 2 }}>{idea.title}</div>
                    <div style={{ fontSize: 11, color: "var(--ib-warn-text)", marginBottom: 2 }}>{idea.whyNow}</div>
                    <div style={{ fontSize: 11, color: "var(--ib-text-dim)" }}>{idea.evidence}</div>
                  </div>
                ))}
              </div>
            )}

            {analysisReport.footerNote && (
              <div className="ib-meta" style={{ marginBottom: 16 }}>{analysisReport.footerNote}</div>
            )}
          </div>
        ) : (
          <div className="ib-panel" style={{ padding: 30, textAlign: "center" }}>
            <div style={{ color: "var(--ib-text-dim)", marginBottom: 12, fontSize: 12 }}>No analysis report yet for this video.</div>
            <button className="ib-btn ib-btn-primary" onClick={() => startAnalysis("video")}>
              RUN DEEP ANALYSIS
            </button>
            <div className="ib-meta" style={{ marginTop: 8 }}>Takes 2-5 minutes. Opens in a new tab — come back when done.</div>
          </div>
        )
      )}

      {/* Retention */}
      {activeTab === "retention" && (
        <div className="ib-panel">
          <div className="ib-panel-head"><h3>Audience Retention</h3></div>
          <div style={{ padding: 14 }}>
            <RetentionChart points={retention} durationSeconds={video.duration_seconds} />
            {retention.length > 0 && (
              <div style={{ display: "flex", gap: 20, marginTop: 12 }}>
                <div className="ib-meta">
                  Start: {retention[0]?.audienceWatchRatio != null ? (retention[0].audienceWatchRatio * 100).toFixed(1) + "%" : "\u2014"}
                </div>
                <div className="ib-meta">
                  Midpoint: {retention[Math.floor(retention.length / 2)]?.audienceWatchRatio != null ? (retention[Math.floor(retention.length / 2)].audienceWatchRatio * 100).toFixed(1) + "%" : "\u2014"}
                </div>
                <div className="ib-meta">
                  End: {retention[retention.length - 1]?.audienceWatchRatio != null ? (retention[retention.length - 1].audienceWatchRatio * 100).toFixed(1) + "%" : "\u2014"}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lifecycle (Feature 3) */}
      {activeTab === "lifecycle" && (
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>Video Lifecycle</h3>
            <span className="ib-meta">View accumulation over time</span>
          </div>
          {lifecycleLoading ? (
            <div className="ib-meta" style={{ padding: 20, textAlign: "center" }}>Loading snapshots...</div>
          ) : lifecycleSnapshots.length === 0 ? (
            <div className="ib-meta" style={{ padding: 20, textAlign: "center" }}>No snapshot data available. The video tracker collects snapshots over time -- check back later.</div>
          ) : (
            <div style={{ padding: 14 }}>
              {/* SVG line chart */}
              {(() => {
                const sorted = [...lifecycleSnapshots].sort((a, b) => a.video_age_hours - b.video_age_hours);
                const w = 700, h = 220, pad = { t: 15, r: 15, b: 35, l: 55 };
                const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
                const maxHours = sorted[sorted.length - 1]?.video_age_hours ?? 1;
                const maxViews = Math.max(...sorted.map(s => s.view_count), 1);
                const toX = (hours: number) => pad.l + (hours / maxHours) * plotW;
                const toY = (views: number) => pad.t + plotH - (views / maxViews) * plotH;

                const pathD = sorted.map((s, i) => `${i === 0 ? "M" : "L"}${toX(s.video_age_hours).toFixed(1)},${toY(s.view_count).toFixed(1)}`).join(" ");

                // Find milestone values
                const milestones = [
                  { label: "24h", hours: 24 },
                  { label: "48h", hours: 48 },
                  { label: "7d", hours: 168 },
                  { label: "30d", hours: 720 },
                ];
                const milestoneValues = milestones.map(m => {
                  const closest = sorted.reduce((best, s) => {
                    if (Math.abs(s.video_age_hours - m.hours) < Math.abs(best.video_age_hours - m.hours)) return s;
                    return best;
                  }, sorted[0]);
                  return {
                    ...m,
                    views: closest && Math.abs(closest.video_age_hours - m.hours) < m.hours * 0.3 ? closest.view_count : null,
                    actualHours: closest?.video_age_hours ?? 0,
                  };
                }).filter(m => m.views != null && m.actualHours <= maxHours);

                // X-axis labels
                const xTicks = [0, 0.25, 0.5, 0.75, 1].map(r => Math.round(r * maxHours));
                const formatHours = (hrs: number) => hrs < 48 ? `${hrs}h` : `${Math.round(hrs / 24)}d`;

                return (
                  <div>
                    <div style={{ overflowX: "auto" }}>
                      <svg width={w} height={h} style={{ display: "block", fontFamily: "var(--ib-mono)", fontSize: 9, fill: "#444" }}>
                        {/* Y gridlines */}
                        {[0, 0.25, 0.5, 0.75, 1].map(r => (
                          <g key={r}>
                            <line x1={pad.l} y1={toY(r * maxViews)} x2={w - pad.r} y2={toY(r * maxViews)} stroke="#1a1a1a" />
                            <text x={pad.l - 6} y={toY(r * maxViews) + 3} textAnchor="end">{fmtNum(Math.round(r * maxViews))}</text>
                          </g>
                        ))}
                        {/* X labels */}
                        {xTicks.map(hrs => (
                          <text key={hrs} x={toX(hrs)} y={h - 5} textAnchor="middle">{formatHours(hrs)}</text>
                        ))}
                        {/* Main line */}
                        <path d={pathD} fill="none" stroke="#5b9" strokeWidth={2} />
                        {/* Milestone dots */}
                        {milestoneValues.map(m => (
                          <g key={m.label}>
                            <circle cx={toX(m.actualHours)} cy={toY(m.views!)} r={4} fill="#5b9" stroke="#0a0a0a" strokeWidth={1.5} />
                            <text x={toX(m.actualHours)} y={toY(m.views!) - 8} textAnchor="middle" fill="#5b9" fontSize={9} fontWeight={700}>
                              {m.label}
                            </text>
                          </g>
                        ))}
                        {/* Data points */}
                        {sorted.map((s, i) => (
                          <circle key={i} cx={toX(s.video_age_hours)} cy={toY(s.view_count)} r={2} fill="#5b9" opacity={0.5} />
                        ))}
                      </svg>
                    </div>

                    {/* Milestone stats */}
                    {milestoneValues.length > 0 && (
                      <div className="ib-stat-row" style={{ marginTop: 12 }}>
                        {milestoneValues.map(m => (
                          <div key={m.label} className="ib-stat-cell">
                            <div className="ib-stat-label">Views at {m.label}</div>
                            <div className="ib-stat-value">{fmtNum(m.views)}</div>
                          </div>
                        ))}
                        {/* Growth rate */}
                        {milestoneValues.length >= 2 && (
                          <div className="ib-stat-cell">
                            <div className="ib-stat-label">Growth Rate</div>
                            <div className="ib-stat-value" style={{ color: "var(--ib-positive-text)" }}>
                              {(() => {
                                const first = milestoneValues[0];
                                const last = milestoneValues[milestoneValues.length - 1];
                                if (!first.views || !last.views || first.views === 0) return "\u2014";
                                const mult = last.views / first.views;
                                return `${mult.toFixed(1)}x`;
                              })()}
                            </div>
                            <div className="ib-meta">{milestoneValues[0].label} to {milestoneValues[milestoneValues.length - 1].label}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Snapshot count */}
                    <div className="ib-meta" style={{ marginTop: 8 }}>
                      {sorted.length} snapshots collected over {formatHours(maxHours)}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Comments */}
      {activeTab === "comments" && (
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>Top Comments</h3>
            <span className="ib-meta">{comments.length} loaded</span>
          </div>
          {/* Sentiment Analysis (Feature 4) */}
          {comments.length > 0 && (
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--ib-border)", display: "flex", gap: 12, alignItems: "flex-start" }}>
              <button
                className="ib-btn ib-btn-primary"
                onClick={analyzeSentiment}
                disabled={sentimentLoading}
                style={{ fontSize: 10, padding: "6px 14px", flexShrink: 0 }}
              >
                {sentimentLoading ? "ANALYZING..." : sentimentData ? "RE-ANALYZE" : "ANALYZE SENTIMENT"}
              </button>
              {sentimentData && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{
                      fontFamily: "var(--ib-mono)", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 2,
                      background: sentimentData.sentiment === "Positive" ? "rgba(74,122,74,0.15)" : sentimentData.sentiment === "Negative" ? "rgba(170,68,68,0.15)" : "rgba(180,160,100,0.15)",
                      color: sentimentData.sentiment === "Positive" ? "#5b9" : sentimentData.sentiment === "Negative" ? "#c55" : "#b8a86a",
                      border: `1px solid ${sentimentData.sentiment === "Positive" ? "#2a3a2e" : sentimentData.sentiment === "Negative" ? "#3a2a2a" : "#3a3520"}`,
                    }}>
                      {sentimentData.sentiment}
                    </span>
                    {sentimentData.sentimentScore != null && (
                      <span className="ib-meta">Score: {sentimentData.sentimentScore}/100</span>
                    )}
                  </div>
                  {sentimentData.themes.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 1, color: "var(--ib-text-dim)", marginBottom: 4 }}>Top Themes</div>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {sentimentData.themes.map((t, i) => (
                          <span key={i} className="ib-tag" style={{ fontSize: 10 }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {sentimentData.keyFeedback.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ fontFamily: "var(--ib-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 1, color: "var(--ib-text-dim)", marginBottom: 4 }}>Key Feedback</div>
                      {sentimentData.keyFeedback.map((f, i) => (
                        <div key={i} style={{ fontSize: 11, color: "var(--ib-text)", lineHeight: 1.6, paddingLeft: 10, borderLeft: "2px solid var(--ib-border)", marginBottom: 3 }}>
                          {f}
                        </div>
                      ))}
                    </div>
                  )}
                  {sentimentData.summary && (
                    <div style={{ fontSize: 11, color: "var(--ib-text-dim)", lineHeight: 1.5, fontStyle: "italic" }}>
                      {sentimentData.summary}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {comments.length === 0 ? (
            <div className="ib-meta" style={{ padding: 20, textAlign: "center" }}>No comments available</div>
          ) : (
            comments.map((c, i) => (
              <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--ib-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: "var(--ib-text-bright)", fontSize: 12, fontWeight: 500 }}>{c.author}</span>
                  <span className="ib-meta">{c.likes > 0 ? `${fmtNum(c.likes)} likes` : ""}{c.reply_count > 0 ? ` \u00B7 ${c.reply_count} replies` : ""}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--ib-text)", lineHeight: 1.6 }}>{c.text}</div>
                {c.replies && c.replies.length > 0 && (
                  <div style={{ marginTop: 8, paddingLeft: 16, borderLeft: "2px solid var(--ib-border)" }}>
                    {c.replies.slice(0, 3).map((r, j) => (
                      <div key={j} style={{ padding: "4px 0", fontSize: 11, color: "var(--ib-text-dim)" }}>
                        <strong>{r.author}</strong>: {r.text.slice(0, 200)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Similar Videos */}
      {activeTab === "similar" && (
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>Similar Moon Videos</h3>
            <span className="ib-meta">by topic: {titleKeywords.slice(0, 3).join(", ")}</span>
          </div>
          {similarLoading ? (
            <div className="ib-meta" style={{ padding: 20, textAlign: "center" }}>Searching...</div>
          ) : similarVideos.length === 0 ? (
            <div className="ib-meta" style={{ padding: 20, textAlign: "center" }}>No similar videos found matching topic keywords</div>
          ) : (
            similarVideos.map(v => (
              <div key={v.youtube_video_id} style={{ borderBottom: "1px solid var(--ib-border)" }}>
                <Link
                  href={`/ideation/analytics/${v.youtube_video_id}`}
                  style={{ display: "flex", gap: 12, padding: "10px 14px", textDecoration: "none", color: "inherit", alignItems: "center" }}
                >
                  <img
                    src={`https://i.ytimg.com/vi/${v.youtube_video_id}/mqdefault.jpg`}
                    alt="" width={100} height={56}
                    style={{ objectFit: "cover", borderRadius: 2, flexShrink: 0 }}
                    loading="lazy"
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "var(--ib-text-bright)", fontSize: 12, fontWeight: 500, marginBottom: 2 }}>{v.title}</div>
                    <div className="ib-meta">{fmtDate(v.published_at)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "var(--ib-mono)", fontSize: 13, fontWeight: 600, color: "var(--ib-highlight)" }}>{fmtNum(v.views)}</div>
                      <div className="ib-meta">views</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "var(--ib-mono)", fontSize: 12, color: (v.average_view_percentage ?? 0) > 40 ? "var(--ib-positive-text)" : "var(--ib-text-dim)" }}>{fmtPct(v.average_view_percentage)}</div>
                      <div className="ib-meta">retention</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "var(--ib-mono)", fontSize: 12, color: (v.net_subscribers ?? 0) > 0 ? "var(--ib-positive-text)" : "var(--ib-text-dim)" }}>
                        {(v.net_subscribers ?? 0) > 0 ? "+" : ""}{fmtNum(v.net_subscribers)}
                      </div>
                      <div className="ib-meta">subs</div>
                    </div>
                  </div>
                </Link>
              </div>
            ))
          )}
          {/* Performance comparison against similar */}
          {similarVideos.length > 0 && (
            <div style={{ padding: "10px 14px", background: "var(--ib-surface2)" }}>
              <div className="ib-meta" style={{ marginBottom: 4 }}>
                This video vs similar topics average:
              </div>
              {(() => {
                const simAvgViews = similarVideos.reduce((s, v) => s + (v.views ?? 0), 0) / similarVideos.length;
                const simAvgRet = similarVideos.filter(v => v.average_view_percentage).reduce((s, v) => s + (v.average_view_percentage ?? 0), 0) / (similarVideos.filter(v => v.average_view_percentage).length || 1);
                const viewsDiff = ((video.views ?? 0) / (simAvgViews || 1) * 100) - 100;
                const retDiff = (video.average_view_percentage ?? 0) - simAvgRet;
                return (
                  <div style={{ display: "flex", gap: 16 }}>
                    <span style={{ fontFamily: "var(--ib-mono)", fontSize: 11, color: viewsDiff >= 0 ? "var(--ib-positive-text)" : "var(--ib-negative-text)" }}>
                      Views: {viewsDiff >= 0 ? "+" : ""}{viewsDiff.toFixed(0)}% vs avg
                    </span>
                    <span style={{ fontFamily: "var(--ib-mono)", fontSize: 11, color: retDiff >= 0 ? "var(--ib-positive-text)" : "var(--ib-negative-text)" }}>
                      Retention: {retDiff >= 0 ? "+" : ""}{retDiff.toFixed(1)}pp vs avg
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Compare */}
      {activeTab === "compare" && (
        <div className="ib-panel">
          <div className="ib-panel-head"><h3>Recent Videos Comparison</h3></div>
          <table className="ib-table">
            <thead>
              <tr><th></th><th>Title</th><th>Views</th><th>Retention</th><th>Net Subs</th><th>Shares</th></tr>
            </thead>
            <tbody>
              {/* Current video highlighted */}
              <tr style={{ background: "rgba(85,187,153,0.05)" }}>
                <td style={{ width: 60, padding: "4px 8px" }}>
                  <img src={`https://i.ytimg.com/vi/${video.youtube_video_id}/mqdefault.jpg`} alt="" width={60} height={34} style={{ objectFit: "cover", borderRadius: 2 }} />
                </td>
                <td style={{ color: "#5b9", fontWeight: 600, fontSize: 12 }}>{video.title}</td>
                <td style={{ fontFamily: "var(--ib-mono)", fontWeight: 600 }}>{fmtNum(video.views)}</td>
                <td style={{ fontFamily: "var(--ib-mono)" }}>{fmtPct(video.average_view_percentage)}</td>
                <td style={{ fontFamily: "var(--ib-mono)" }}>{fmtNum(video.net_subscribers)}</td>
                <td style={{ fontFamily: "var(--ib-mono)" }}>{fmtNum(video.shares)}</td>
              </tr>
              {recentVideos.filter(v => v.youtube_video_id !== video.youtube_video_id).slice(0, 10).map(v => (
                <tr key={v.youtube_video_id}>
                  <td style={{ width: 60, padding: "4px 8px" }}>
                    <img src={`https://i.ytimg.com/vi/${v.youtube_video_id}/mqdefault.jpg`} alt="" width={60} height={34} style={{ objectFit: "cover", borderRadius: 2 }} />
                  </td>
                  <td>
                    <Link href={`/ideation/analytics/${v.youtube_video_id}`} style={{ color: "var(--ib-text)", textDecoration: "none", fontSize: 12 }}>
                      {v.title}
                    </Link>
                  </td>
                  <td style={{ fontFamily: "var(--ib-mono)" }}>{fmtNum(v.views)}</td>
                  <td style={{ fontFamily: "var(--ib-mono)" }}>{fmtPct(v.average_view_percentage)}</td>
                  <td style={{ fontFamily: "var(--ib-mono)" }}>{fmtNum(v.net_subscribers)}</td>
                  <td style={{ fontFamily: "var(--ib-mono)" }}>{fmtNum(v.shares)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
