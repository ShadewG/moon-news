"use client";

import Link from "next/link";
import { useState } from "react";

type AnyRecord = Record<string, unknown>;

interface Props {
  data: AnyRecord;
  slug: string;
}

function countAssets(seg: AnyRecord): number {
  return (
    ((seg.resolvedClips as unknown[]) ?? []).length +
    ((seg.resolvedQuotes as unknown[]) ?? []).length +
    ((seg.resolvedImages as unknown[]) ?? []).length +
    ((seg.resolvedReceipts as unknown[]) ?? []).length +
    ((seg.resolvedStocks as unknown[]) ?? []).length +
    ((seg.reactionPosts as unknown[]) ?? []).length
  );
}

function S(v: unknown): string {
  return v == null ? "" : String(v);
}

function N(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeFrameUrl(url: string): string {
  if (url.startsWith("/generated-frames/")) {
    return `/api${url}`;
  }
  return url;
}

function isRetentionReport(d: AnyRecord): boolean {
  const report = d.report as AnyRecord | undefined;
  return Boolean(report && Array.isArray(report.line_reviews));
}

function RetentionReportView({ data, slug }: Props) {
  const report = data.report as AnyRecord;
  const lineReviews = (report.line_reviews ?? []) as AnyRecord[];
  const [openLines, setOpenLines] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpenLines((p) => {
      const n = new Set(p);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const verdict = S(report.overall_verdict);
  const vc = verdict === "strong" ? "#5b9" : verdict === "weak" ? "#a44" : "#c93";

  return (
    <>
      <style>{retentionStyles}</style>
      <div className="sa-root">
        <header className="sa-header">
          <Link href="/script-lab" className="sa-back">&larr; Generate</Link>
          <div className="sa-header-main">
            <div className="sa-header-left">
              <h1 className="sa-title">{S(data.scriptTitle) || slug.replace(/-/g, " ")}</h1>
              <div className="sa-header-meta">
                <span className="sa-badge" style={{ background: vc + "22", color: vc, borderColor: vc + "44" }}>retention: {verdict}</span>
                <span className="sa-meta-text">{lineReviews.length} lines reviewed</span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">{S(data.model)}</span>
              </div>
            </div>
          </div>
        </header>
        <div className="rt-body">
          <div className="rt-coverage">{S(report.coverage_note)}</div>
          <div className="rt-intro">
            <div className="rt-label">Intro Assessment</div>
            <div className="rt-intro-text">{S(report.intro_verdict)}</div>
            {S(report.suggested_intro_rewrite) && (
              <div className="rt-rewrite">{S(report.suggested_intro_rewrite)}</div>
            )}
          </div>
          <div className="rt-grid">
            {((report.strengths_to_keep ?? []) as string[]).length > 0 && (
              <div className="rt-card">
                <div className="rt-label" style={{ color: "#5b9" }}>Strengths</div>
                {((report.strengths_to_keep ?? []) as string[]).map((s, i) => <div key={i} className="rt-item rt-item-green">{s}</div>)}
              </div>
            )}
            {((report.global_risks ?? []) as string[]).length > 0 && (
              <div className="rt-card">
                <div className="rt-label" style={{ color: "#a44" }}>Risks</div>
                {((report.global_risks ?? []) as string[]).map((s, i) => <div key={i} className="rt-item rt-item-red">{s}</div>)}
              </div>
            )}
            {((report.rewrite_priorities ?? []) as string[]).length > 0 && (
              <div className="rt-card">
                <div className="rt-label" style={{ color: "#c93" }}>Rewrite Priorities</div>
                {((report.rewrite_priorities ?? []) as string[]).map((s, i) => <div key={i} className="rt-item rt-item-amber">{s}</div>)}
              </div>
            )}
          </div>
          <div className="rt-lines">
            <div className="rt-label" style={{ padding: "10px 14px", borderBottom: "1px solid #181818" }}>Line Reviews</div>
            {lineReviews.map((r, i) => {
              const open = openLines.has(i);
              const action = S(r.action);
              const ac = action === "keep" ? "#5b9" : action === "cut" ? "#a44" : action === "tighten" ? "#c93" : action === "rewrite" ? "#c87a4a" : "#68a";
              return (
                <div key={i} className={`rt-line ${open ? "rt-line-open" : ""}`} onClick={() => toggle(i)}>
                  <div className="rt-line-head">
                    <span className="rt-line-num">{S(r.line_number)}</span>
                    <span className="rt-badge" style={{ borderColor: "#333", color: "#666" }}>{S(r.phase)}</span>
                    <span className="rt-badge" style={{ background: ac + "22", color: ac }}>{action}</span>
                    <span className="rt-line-text">{S(r.line_text)}</span>
                    <span style={{ color: "#444", fontSize: 10, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
                  </div>
                  {open && (
                    <div className="rt-line-detail">
                      {S(r.rationale) && <><div className="rt-sublabel">Why</div><div className="rt-detail-text">{S(r.rationale)}</div></>}
                      {S(r.recommended_revision) && <><div className="rt-sublabel">Revision</div><div className="rt-rewrite" style={{ marginTop: 4 }}>{S(r.recommended_revision)}</div></>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

const retentionStyles = `
  .rt-body { padding: 16px 20px; max-width: 960px; }
  .rt-coverage { font-size: 11px; color: #666; margin-bottom: 12px; font-family: var(--font-geist-mono), monospace; }
  .rt-intro { background: #0c0c0c; border: 1px solid #181818; padding: 12px 14px; margin-bottom: 14px; }
  .rt-intro-text { font-size: 12px; color: #999; line-height: 1.6; }
  .rt-rewrite { margin-top: 8px; padding: 8px 10px; border-left: 2px solid #5b9; background: #0a1a0e; font-size: 11px; color: #aaa; font-style: italic; line-height: 1.6; white-space: pre-wrap; }
  .rt-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #444; margin-bottom: 6px; font-family: var(--font-geist-mono), monospace; }
  .rt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .rt-card { background: #0c0c0c; border: 1px solid #181818; padding: 12px 14px; }
  .rt-item { font-size: 11px; color: #999; line-height: 1.5; padding: 3px 0; border-bottom: 1px solid #141414; }
  .rt-item:last-child { border-bottom: none; }
  .rt-item-green { color: #7a9; }
  .rt-item-red { color: #a77; }
  .rt-item-amber { color: #b96; }
  .rt-lines { background: #0c0c0c; border: 1px solid #181818; }
  .rt-line { border-bottom: 1px solid #141414; cursor: pointer; }
  .rt-line:hover { background: rgba(255,255,255,0.01); }
  .rt-line-head { display: flex; align-items: flex-start; gap: 8px; padding: 8px 14px; font-size: 11px; }
  .rt-line-num { font-family: var(--font-geist-mono), monospace; font-size: 10px; color: #444; min-width: 22px; text-align: right; flex-shrink: 0; }
  .rt-badge { font-family: var(--font-geist-mono), monospace; font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border: 1px solid transparent; border-radius: 2px; flex-shrink: 0; }
  .rt-line-text { flex: 1; color: #999; line-height: 1.5; min-width: 0; }
  .rt-line-detail { padding: 0 14px 10px 50px; font-size: 11px; line-height: 1.6; }
  .rt-sublabel { font-family: var(--font-geist-mono), monospace; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #444; margin-top: 6px; margin-bottom: 2px; }
  .rt-detail-text { color: #888; }
`;

export default function AssetsDetailClient({ data, slug }: Props) {
  if (isRetentionReport(data)) {
    return <RetentionReportView data={data} slug={slug} />;
  }
  return <AssetReportView data={data} slug={slug} />;
}

function formatMs(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

/* ─── Clip Thumbnail with inline YouTube embed ─── */
function ClipThumbnail({ url, size = "large" }: { url: string; size?: "large" | "small" }) {
  const [playing, setPlaying] = useState(false);
  const ytId = extractYouTubeId(url);
  if (!ytId) return null;

  const isLarge = size === "large";
  const w = isLarge ? 200 : 72;
  const h = isLarge ? 120 : 48;

  if (playing) {
    return (
      <iframe
        width={isLarge ? 320 : 200}
        height={isLarge ? 180 : 112}
        src={`https://www.youtube.com/embed/${ytId}?autoplay=1`}
        frameBorder="0"
        allow="autoplay; encrypted-media"
        allowFullScreen
        style={{ borderRadius: 3, background: "#000", display: "block", flexShrink: 0 }}
      />
    );
  }

  return (
    <div
      style={{ position: "relative", cursor: "pointer", width: w, height: h, flexShrink: 0, borderRadius: 3, overflow: "hidden", background: "#111" }}
      onClick={(e) => { e.stopPropagation(); setPlaying(true); }}
    >
      <img
        src={`https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`}
        alt="" width={w} height={h}
        style={{ objectFit: "cover", display: "block", width: w, height: h }}
        loading="lazy"
      />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: isLarge ? 32 : 20, height: isLarge ? 32 : 20, borderRadius: "50%", background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#fff", fontSize: isLarge ? 14 : 9, marginLeft: isLarge ? 2 : 1 }}>{"\u25B6"}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Collapsible toggle button ─── */
function ToggleButton({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        style={{
          fontFamily: "inherit", fontSize: 9, fontWeight: 600, padding: "3px 8px",
          borderRadius: 3, border: "1px solid #1a1a1a", background: open ? "#151515" : "#0c0c0c",
          color: open ? "#aaa" : "#555", cursor: "pointer", transition: "all 0.12s",
          textTransform: "uppercase", letterSpacing: "0.5px",
        }}
      >
        {label} ({count}) {open ? "\u25BE" : "\u25B8"}
      </button>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

/* ─── Single script line row ─── */
function PartRow({
  part,
  partIndex,
  assignment,
  resolvedClips,
  resolvedImages,
  resolvedQuotes,
  resolvedReceipts,
  videoSearches,
  imageSearches,
  receiptSearches,
}: {
  part: AnyRecord;
  partIndex: number;
  assignment: AnyRecord | null;
  resolvedClips: AnyRecord[];
  resolvedImages: AnyRecord[];
  resolvedQuotes: AnyRecord[];
  resolvedReceipts: AnyRecord[];
  videoSearches: AnyRecord[];
  imageSearches: AnyRecord[];
  receiptSearches: AnyRecord[];
}) {
  const timeLabel = S(part.timeLabel) || `Part ${partIndex + 1}`;
  const scriptText = S(part.scriptText);
  const clipKind = S(part.clipKind);
  const clipHint = S(part.clipTitleHint);
  const quoteText = S(part.clipQuoteText);

  // Primary clip from assignment
  const primaryClipUrl = assignment ? S(assignment.clipUrl) : "";
  const visualType = assignment ? S(assignment.visualType) : "";
  const assignmentNote = assignment ? S(assignment.note) : "";
  const altClipUrls = assignment ? ((assignment.alternateClipUrls ?? []) as string[]).filter(Boolean) : [];
  const altImageUrls = assignment ? ((assignment.alternateImageUrls ?? []) as string[]).filter(Boolean) : [];
  const altReceiptUrls = assignment ? ((assignment.alternateReceiptUrls ?? []) as string[]).filter(Boolean) : [];

  // Find the resolved clip data for the primary clip
  const primaryClipData = primaryClipUrl
    ? resolvedClips.find((c) => S(c.sourceUrl) === primaryClipUrl)
    : null;

  // For alternate clips, find their resolved data
  const altClipData = altClipUrls.map((url) => {
    const resolved = resolvedClips.find((c) => S(c.sourceUrl) === url);
    return { url, data: resolved || null };
  });

  // If no assignment, show top resolved clips as fallback
  const fallbackClips = !assignment && resolvedClips.length > 0
    ? resolvedClips.slice(0, 3)
    : [];

  return (
    <div className="sl-part-row">
      {/* Header: beat label + script text */}
      <div className="sl-part-header">
        <span className="sl-part-beat">{timeLabel}</span>
        {clipKind && <span className="sl-part-kind">{clipKind}</span>}
        {visualType && !clipKind && <span className="sl-part-kind">{visualType}</span>}
      </div>
      <div className="sl-part-text">{scriptText}</div>

      {/* Clip hint / quote text */}
      {clipHint && <div className="sl-part-hint">{clipHint}</div>}
      {quoteText && (
        <div className="sl-part-quote">&ldquo;{quoteText}&rdquo;</div>
      )}

      {/* Assignment note */}
      {assignmentNote && (
        <div className="sl-part-note">{assignmentNote}</div>
      )}

      {/* Primary clip + alternates */}
      {(primaryClipUrl || fallbackClips.length > 0) && (
        <div className="sl-clip-row">
          {/* Primary */}
          {primaryClipUrl && (
            <div className="sl-primary-clip">
              <ClipThumbnail url={primaryClipUrl} size="large" />
              <div className="sl-clip-info">
                {primaryClipData ? (
                  <>
                    <a href={primaryClipUrl} target="_blank" rel="noopener noreferrer" className="sl-clip-title">
                      {S(primaryClipData.title) || "Untitled clip"}
                    </a>
                    <div className="sl-clip-meta">
                      {S(primaryClipData.channelOrContributor)}
                      {Number(primaryClipData.viewCount) > 0 ? ` \u00B7 ${Number(primaryClipData.viewCount).toLocaleString()} views` : ""}
                      {Number(primaryClipData.relevanceScore) > 0 ? ` \u00B7 rel ${Number(primaryClipData.relevanceScore).toFixed(0)}` : ""}
                    </div>
                  </>
                ) : (
                  <a href={primaryClipUrl} target="_blank" rel="noopener noreferrer" className="sl-clip-title">
                    {primaryClipUrl.length > 60 ? primaryClipUrl.slice(0, 60) + "..." : primaryClipUrl}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Alternates */}
          {altClipData.length > 0 && (
            <div className="sl-alt-clips">
              <div className="sl-alt-label">Alternates</div>
              <div className="sl-alt-thumbs">
                {altClipData.map((alt, ai) => (
                  <div key={`alt-${ai}`} className="sl-alt-thumb-wrap">
                    <ClipThumbnail url={alt.url} size="small" />
                    {alt.data && (
                      <div className="sl-alt-thumb-title" title={S(alt.data.title)}>
                        {S(alt.data.title).slice(0, 30) || "Alt clip"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Alt images */}
          {altImageUrls.length > 0 && (
            <div className="sl-alt-clips">
              <div className="sl-alt-label">Alt Images</div>
              <div className="sl-alt-thumbs">
                {altImageUrls.map((url, ai) => (
                  <a key={`alt-img-${ai}`} href={url} target="_blank" rel="noopener noreferrer" style={{ display: "block", width: 72, height: 48, borderRadius: 3, overflow: "hidden", background: "#111", flexShrink: 0 }}>
                    <img src={url} alt="" style={{ width: 72, height: 48, objectFit: "cover", display: "block" }} loading="lazy" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Fallback: top clips from resolved pool */}
          {fallbackClips.length > 0 && (
            <div className="sl-fallback-clips">
              <div className="sl-alt-label">Top Clips (unassigned)</div>
              <div className="sl-alt-thumbs">
                {fallbackClips.map((clip, fi) => {
                  const clipUrl = S(clip.sourceUrl);
                  return (
                    <div key={`fb-${fi}`} className="sl-alt-thumb-wrap">
                      <ClipThumbnail url={clipUrl} size="small" />
                      <div className="sl-alt-thumb-title" title={S(clip.title)}>
                        {S(clip.title).slice(0, 30) || "Clip"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quote display if this is a quote visual type */}
      {visualType === "quote" && resolvedQuotes.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {resolvedQuotes.slice(0, 2).map((q, qi) => (
            <div key={`rq-${qi}`} className="sl-resolved-quote">
              <div className="sl-resolved-quote-text">&ldquo;{S(q.quoteText)}&rdquo;</div>
              <div className="sl-resolved-quote-meta">
                {S(q.speaker) ? `${S(q.speaker)} \u00B7 ` : ""}
                {N(q.startMs) != null ? formatMs(N(q.startMs) ?? 0) : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Collapsed extras */}
      <div className="sl-extras-row">
        <ToggleButton label="Searches" count={videoSearches.length + imageSearches.length + receiptSearches.length}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {videoSearches.map((s, si) => (
              <a key={`vs-${si}`} href={S(s.url) || "#"} target="_blank" rel="noopener noreferrer" className="sl-search-chip sl-chip-video">
                {S(s.query) || "search"}
              </a>
            ))}
            {imageSearches.map((s, si) => (
              <a key={`is-${si}`} href={S(s.url) || "#"} target="_blank" rel="noopener noreferrer" className="sl-search-chip sl-chip-image">
                {S(s.query) || "image search"}
              </a>
            ))}
            {receiptSearches.map((s, si) => (
              <a key={`rs-${si}`} href={S(s.url) || "#"} target="_blank" rel="noopener noreferrer" className="sl-search-chip sl-chip-receipt">
                {S(s.query) || "article search"}
              </a>
            ))}
          </div>
        </ToggleButton>

        <ToggleButton label="Articles" count={resolvedReceipts.length}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {resolvedReceipts.map((r, ri) => (
              <div key={`rec-${ri}`} className="sl-receipt-item">
                <a href={S(r.url)} target="_blank" rel="noopener noreferrer" className="sl-receipt-title">
                  {S(r.title) || S(r.url)}
                </a>
                {S(r.snippet) && <div className="sl-receipt-snippet">{S(r.snippet)}</div>}
              </div>
            ))}
          </div>
        </ToggleButton>

        <ToggleButton label="Images" count={resolvedImages.length}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {resolvedImages.map((img, ii) => (
              <a key={`img-${ii}`} href={S(img.imageUrl)} target="_blank" rel="noopener noreferrer" style={{ display: "block", width: 80, height: 56, borderRadius: 3, overflow: "hidden", background: "#111", flexShrink: 0, border: "1px solid #1a1a1a" }}>
                <img src={S(img.imageUrl)} alt={S(img.title)} style={{ width: 80, height: 56, objectFit: "cover", display: "block" }} loading="lazy" />
              </a>
            ))}
          </div>
        </ToggleButton>
      </div>
    </div>
  );
}

/* ─── Main AssetReportView ─── */
function AssetReportView({ data, slug }: Props) {
  const [reportData, setReportData] = useState<AnyRecord>(data);
  const segments = (reportData.segments ?? []) as AnyRecord[];
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [segmentJobs, setSegmentJobs] = useState<Record<number, { status: string; error?: string }>>({});
  const [globalMessage, setGlobalMessage] = useState<string>("");

  const updateSegment = (segmentIndex: number, nextSegment: AnyRecord) => {
    setReportData((prev) => {
      const prevSegments = (prev.segments ?? []) as AnyRecord[];
      const updatedSegments = prevSegments.map((segment) =>
        Number(segment.index ?? 0) === segmentIndex ? nextSegment : segment
      );
      return { ...prev, segments: updatedSegments };
    });
  };

  const enrichSegment = async (segmentIndex: number) => {
    setSegmentJobs((prev) => ({ ...prev, [segmentIndex]: { status: "running" } }));
    try {
      const response = await fetch(`/api/script-lab/assets/${slug}/enrich`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segmentIndex }),
      });
      const payload = (await response.json().catch(() => ({}))) as AnyRecord;
      if (!response.ok) {
        throw new Error(S(payload.error) || `Failed to enrich segment ${segmentIndex}`);
      }
      updateSegment(segmentIndex, (payload.segment ?? {}) as AnyRecord);
      setSegmentJobs((prev) => ({ ...prev, [segmentIndex]: { status: "complete" } }));
      setGlobalMessage(`Enriched section ${segmentIndex}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to enrich segment ${segmentIndex}`;
      setSegmentJobs((prev) => ({ ...prev, [segmentIndex]: { status: "failed", error: message } }));
      setGlobalMessage(message);
    }
  };

  const enrichAll = async () => {
    setGlobalMessage("Enriching all sections...");
    for (const segment of segments) {
      const segmentIndex = Number(segment.index ?? 0);
      if (!segmentIndex) continue;
      await enrichSegment(segmentIndex);
    }
    setGlobalMessage("Finished enrichment pass.");
  };

  const toggle = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const expandAll = () => {
    setExpanded(new Set(segments.map((_, i) => Number((segments[i] as AnyRecord).index ?? i))));
  };
  const collapseAll = () => setExpanded(new Set());

  const totalAssets = segments.reduce((sum, seg) => sum + countAssets(seg), 0);
  const totalClips = segments.reduce((sum, seg) => sum + ((seg.resolvedClips as unknown[]) ?? []).length, 0);
  const totalParts = segments.reduce((sum, seg) => sum + ((seg.parts as unknown[]) ?? []).length, 0);

  return (
    <>
      <style>{styles}</style>
      <div className="sa-root">
        <header className="sa-header">
          <Link href="/script-lab?tab=resolve" className="sa-back">&larr; Generate</Link>
          <div className="sa-header-main">
            <div className="sa-header-left">
              <h1 className="sa-title">{S(data.scriptTitle) || slug.replace(/-/g, " ")}</h1>
              <div className="sa-header-meta">
                <span className="sa-badge sa-badge-green">script editor</span>
                <span className="sa-meta-text">{segments.length} segments</span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">{totalParts} lines</span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text sa-meta-accent">{totalAssets} assets</span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">{totalClips} clips</span>
                {data.resolverModelName ? (
                  <>
                    <span className="sa-meta-sep">|</span>
                    <span className="sa-meta-text">{S(data.resolverModelName)}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="sa-content">
          <div className="ar-toolbar">
            <button className="sa-tool-btn" onClick={expandAll}>Expand All</button>
            <button className="sa-tool-btn" onClick={collapseAll}>Collapse All</button>
            <button className="sa-tool-btn" onClick={enrichAll}>Enrich All</button>
            {globalMessage ? <span className="ar-toolbar-status">{globalMessage}</span> : null}
            <span className="ar-toolbar-info">Line-by-line script view</span>
          </div>

          <div className="sl-segments">
            {segments.map((seg, segmentCursor) => {
              const idx = Number(seg.index ?? segmentCursor + 1);
              const isExpanded = expanded.has(idx);
              const parts = (seg.parts ?? []) as AnyRecord[];
              const blockAssignments = (seg.blockAssignments ?? []) as AnyRecord[];
              const resolvedClips = (seg.resolvedClips ?? []) as AnyRecord[];
              const resolvedImages = (seg.resolvedImages ?? []) as AnyRecord[];
              const resolvedQuotes = (seg.resolvedQuotes ?? []) as AnyRecord[];
              const resolvedReceipts = (seg.resolvedReceipts ?? []) as AnyRecord[];
              const videoSearches = (seg.videoSearches ?? []) as AnyRecord[];
              const imageSearches = (seg.imageSearches ?? []) as AnyRecord[];
              const receiptSearches = (seg.receiptSearches ?? []) as AnyRecord[];
              const enrichment = (seg.enrichment ?? {}) as AnyRecord;
              const segmentJob = segmentJobs[idx];
              const partCount = parts.length;
              const assetCount = countAssets(seg);

              // Build a map: partIndex -> assignment
              const assignmentMap = new Map<number, AnyRecord>();
              for (const ba of blockAssignments) {
                const start = N(ba.startPartIndex) ?? 0;
                const end = N(ba.endPartIndex) ?? start;
                for (let pi = start; pi <= end; pi++) {
                  assignmentMap.set(pi, ba);
                }
              }

              return (
                <div key={idx} className={`sl-segment${isExpanded ? " sl-segment-open" : ""}`}>
                  <button className="sl-segment-header" onClick={() => toggle(idx)} type="button">
                    <span className="sl-seg-idx">#{idx}</span>
                    <span className="sl-seg-beat">{S(seg.beatSummary) || S(seg.timeLabel) || `Segment ${idx}`}</span>
                    <div className="sl-seg-tags">
                      {partCount > 0 && <span className="sl-seg-tag">{partCount} lines</span>}
                      {assetCount > 0 && <span className="sl-seg-tag sl-tag-asset">{assetCount} assets</span>}
                      {S(enrichment.status) === "complete" && <span className="sl-seg-tag sl-tag-enriched">enriched</span>}
                      {segmentJob?.status === "running" && <span className="sl-seg-tag sl-tag-running">enriching</span>}
                      {segmentJob?.status === "failed" && <span className="sl-seg-tag sl-tag-error">failed</span>}
                    </div>
                    <span className="sl-seg-arrow">{isExpanded ? "\u25BE" : "\u25B8"}</span>
                  </button>

                  {isExpanded && (
                    <div className="sl-segment-body">
                      {/* Enrich button + status */}
                      <div className="sl-segment-actions">
                        <button
                          className="sa-tool-btn"
                          onClick={() => enrichSegment(idx)}
                          disabled={segmentJob?.status === "running"}
                        >
                          {segmentJob?.status === "running" ? "Enriching..." : "Enrich"}
                        </button>
                        {S(enrichment.summary) && <span className="sl-segment-status">{S(enrichment.summary)}</span>}
                      </div>

                      {segmentJob?.error && <div className="sl-error-note">{segmentJob.error}</div>}

                      {/* People & orgs */}
                      {(((seg.people as string[]) ?? []).length > 0 || ((seg.orgs as string[]) ?? []).length > 0) && (
                        <div className="sl-entities">
                          {((seg.people as string[]) ?? []).map((p, i) => (
                            <span key={`p${i}`} className="sl-entity sl-entity-person">{p}</span>
                          ))}
                          {((seg.orgs as string[]) ?? []).map((o, i) => (
                            <span key={`o${i}`} className="sl-entity sl-entity-org">{o}</span>
                          ))}
                        </div>
                      )}

                      {/* Line-by-line parts */}
                      {parts.length > 0 ? (
                        <div className="sl-parts">
                          {parts.map((part, pi) => {
                            // Assignment uses 1-based indexing typically
                            const assignment = assignmentMap.get(pi + 1) ?? assignmentMap.get(pi) ?? null;
                            return (
                              <PartRow
                                key={`part-${pi}`}
                                part={part}
                                partIndex={pi}
                                assignment={assignment}
                                resolvedClips={resolvedClips}
                                resolvedImages={resolvedImages}
                                resolvedQuotes={resolvedQuotes}
                                resolvedReceipts={resolvedReceipts}
                                videoSearches={videoSearches}
                                imageSearches={imageSearches}
                                receiptSearches={receiptSearches}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        /* Fallback: show full script text if no parts */
                        S(seg.scriptText) ? (
                          <div className="sl-script-fallback">{S(seg.scriptText)}</div>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {segments.length === 0 && (
            <div className="sl-empty">
              <div className="sl-empty-icon">{"\u25C7"}</div>
              <div className="sl-empty-text">No segments in this asset report</div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

const styles = `
/* ─── Base ─── */
.sa-root { min-height: calc(100vh - 32px); background: #080808; color: #999; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; }
.sa-header { padding: 16px 24px 12px; border-bottom: 1px solid #151515; }
.sa-back { font-size: 10px; color: #444; text-decoration: none; transition: color 0.12s; }
.sa-back:hover { color: #5b9; }
.sa-header-main { margin-top: 10px; display: flex; align-items: flex-start; gap: 16px; }
.sa-header-left { flex: 1; }
.sa-title { font-size: 20px; font-weight: 700; color: #ccc; letter-spacing: -0.5px; margin-bottom: 8px; }
.sa-header-meta { display: flex; align-items: center; gap: 0; flex-wrap: wrap; font-size: 10px; color: #555; }
.sa-meta-text { padding: 0 2px; }
.sa-meta-accent { color: #5b9; }
.sa-meta-sep { color: #222; padding: 0 6px; }
.sa-badge { font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 2px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 4px; }
.sa-badge-green { background: #1a2a1e; color: #5b9; }
.sa-badge-blue { background: #0f1a2a; color: #68a; }
.sa-badge-muted { background: #181818; color: #555; }
.sa-content { padding: 0 24px 24px; }
.sa-tool-btn { font-family: inherit; font-size: 10px; font-weight: 600; padding: 5px 12px; border-radius: 3px; border: 1px solid #1a1a1a; background: #0c0c0c; color: #777; cursor: pointer; transition: all 0.12s; }
.sa-tool-btn:hover { background: #151515; color: #bbb; border-color: #333; }
.sa-tool-btn:disabled { opacity: 0.55; cursor: wait; }

/* ─── Toolbar ─── */
.ar-toolbar { display: flex; align-items: center; gap: 8px; padding: 14px 0; }
.ar-toolbar-status { font-size: 10px; color: #68a; }
.ar-toolbar-info { font-size: 10px; color: #333; margin-left: auto; }

/* ─── Segments ─── */
.sl-segments { display: flex; flex-direction: column; gap: 4px; }

.sl-segment { border: 1px solid #151515; border-radius: 4px; overflow: hidden; background: #0c0c0c; }
.sl-segment-open { border-color: #1a1a1a; }

.sl-segment-header { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 16px; background: transparent; border: none; color: inherit; font-family: inherit; font-size: 11px; cursor: pointer; text-align: left; transition: background 0.1s; }
.sl-segment-header:hover { background: #111; }

.sl-seg-idx { flex-shrink: 0; width: 28px; font-size: 10px; font-weight: 700; color: #333; }
.sl-seg-beat { flex: 1; color: #aaa; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; }
.sl-seg-tags { display: flex; gap: 4px; flex-shrink: 0; }
.sl-seg-tag { font-size: 8px; padding: 2px 6px; border-radius: 2px; background: #151515; color: #555; text-transform: uppercase; letter-spacing: 0.3px; }
.sl-tag-asset { background: #0f1a2a; color: #68a; }
.sl-tag-enriched { background: #112016; color: #79c79a; }
.sl-tag-running { background: #0e1824; color: #7fb5ff; }
.sl-tag-error { background: #241010; color: #ff8f8f; }
.sl-seg-arrow { flex-shrink: 0; color: #333; font-size: 10px; width: 14px; text-align: center; }

/* ─── Segment body ─── */
.sl-segment-body { padding: 0 0 8px; border-top: 1px solid #151515; }

.sl-segment-actions { display: flex; align-items: center; gap: 10px; padding: 10px 16px; }
.sl-segment-status { font-size: 10px; color: #5b9; }
.sl-error-note { font-size: 10px; color: #e6a1a1; background: #1b0e0e; padding: 8px 12px; margin: 0 16px 8px; border-radius: 3px; border-left: 2px solid #a44; line-height: 1.5; }

.sl-entities { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 16px 8px; }
.sl-entity { font-size: 9px; padding: 2px 8px; border-radius: 2px; }
.sl-entity-person { background: #0f1a2a; color: #68a; border: 1px solid #1a2a3a; }
.sl-entity-org { background: #1a0f2a; color: #86a; border: 1px solid #2a1a3a; }

/* ─── Parts (script lines) ─── */
.sl-parts { display: flex; flex-direction: column; gap: 0; }

.sl-part-row { padding: 12px 16px; border-bottom: 1px solid #111; transition: background 0.1s; }
.sl-part-row:hover { background: rgba(255,255,255,0.01); }
.sl-part-row:last-child { border-bottom: none; }

.sl-part-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.sl-part-beat { font-size: 9px; font-weight: 700; color: #7dc; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; }
.sl-part-kind { font-size: 8px; padding: 1px 6px; border-radius: 2px; background: #151520; color: #88a; text-transform: uppercase; letter-spacing: 0.3px; }

.sl-part-text { font-size: 12px; line-height: 1.7; color: #bbb; }

.sl-part-hint { font-size: 10px; color: #666; margin-top: 3px; font-style: italic; }
.sl-part-quote { font-size: 11px; color: #d8d2a0; margin-top: 4px; font-style: italic; line-height: 1.5; padding: 6px 10px; background: #0d0d08; border-left: 2px solid #c9c96a; border-radius: 2px; }
.sl-part-note { font-size: 9px; color: #c93; margin-top: 4px; padding: 4px 8px; background: #1a1208; border-radius: 2px; border-left: 2px solid #c93; }

/* ─── Clip display ─── */
.sl-clip-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; margin-top: 8px; }

.sl-primary-clip { display: flex; gap: 10px; align-items: flex-start; }
.sl-clip-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sl-clip-title { font-size: 11px; color: #bbb; text-decoration: none; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sl-clip-title:hover { color: #fff; }
.sl-clip-meta { font-size: 9px; color: #555; line-height: 1.4; }

.sl-alt-clips { display: flex; flex-direction: column; gap: 4px; }
.sl-alt-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #333; }
.sl-alt-thumbs { display: flex; gap: 6px; flex-wrap: wrap; }
.sl-alt-thumb-wrap { display: flex; flex-direction: column; gap: 2px; max-width: 80px; }
.sl-alt-thumb-title { font-size: 8px; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sl-fallback-clips { display: flex; flex-direction: column; gap: 4px; }

/* ─── Quote display ─── */
.sl-resolved-quote { padding: 6px 10px; background: #0d0d08; border: 1px solid #1a1a10; border-radius: 3px; margin-bottom: 4px; }
.sl-resolved-quote-text { font-size: 11px; color: #d8d2a0; line-height: 1.5; font-style: italic; }
.sl-resolved-quote-meta { font-size: 9px; color: #666; margin-top: 2px; }

/* ─── Extras row ─── */
.sl-extras-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }

.sl-search-chip { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; border: 1px solid #1b1b1b; background: #101010; color: #7aa; text-decoration: none; font-size: 9px; line-height: 1.3; }
.sl-search-chip:hover { background: #181818; color: #9cc; }
.sl-chip-video { color: #68a; }
.sl-chip-image { color: #a68a; }
.sl-chip-receipt { color: #c93; }

.sl-receipt-item { padding: 4px 0; }
.sl-receipt-title { font-size: 10px; color: #bbb; text-decoration: none; }
.sl-receipt-title:hover { color: #fff; }
.sl-receipt-snippet { font-size: 9px; color: #555; line-height: 1.4; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* ─── Script fallback ─── */
.sl-script-fallback { font-size: 12px; line-height: 1.8; color: #888; white-space: pre-wrap; padding: 12px 16px; background: #0a0a0a; border-top: 1px solid #131313; }

/* ─── Empty state ─── */
.sl-empty { text-align: center; padding: 60px 20px; color: #333; }
.sl-empty-icon { font-size: 28px; margin-bottom: 10px; }
.sl-empty-text { font-size: 12px; }

@media (max-width: 900px) {
  .sl-seg-tags { display: none; }
  .sl-clip-row { flex-direction: column; }
}
`;
