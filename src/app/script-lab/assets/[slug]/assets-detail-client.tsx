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

export default function AssetsDetailClient({ data, slug }: Props) {
  const segments = (data.segments ?? []) as AnyRecord[];
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

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
  const totalClips = segments.reduce(
    (sum, seg) => sum + ((seg.resolvedClips as unknown[]) ?? []).length,
    0
  );
  const totalQuotes = segments.reduce(
    (sum, seg) => sum + ((seg.resolvedQuotes as unknown[]) ?? []).length,
    0
  );
  const totalImages = segments.reduce(
    (sum, seg) => sum + ((seg.resolvedImages as unknown[]) ?? []).length,
    0
  );

  return (
    <>
      <style>{styles}</style>
      <div className="sa-root">
        <header className="sa-header">
          <Link href="/script-lab?tab=resolve" className="sa-back">
            &larr; Generate
          </Link>
          <div className="sa-header-main">
            <div className="sa-header-left">
              <h1 className="sa-title">
                {S(data.scriptTitle) || slug.replace(/-/g, " ")}
              </h1>
              <div className="sa-header-meta">
                <span className="sa-badge sa-badge-green">asset report</span>
                <span className="sa-meta-text">
                  {segments.length} segments
                </span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text sa-meta-accent">
                  {totalAssets} total assets
                </span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">{totalClips} clips</span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">{totalQuotes} quotes</span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">{totalImages} images</span>
                {data.resolverModelName ? (
                  <>
                    <span className="sa-meta-sep">|</span>
                    <span className="sa-meta-text">
                      {S(data.resolverModelName)}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="sa-content">
          {/* Toolbar */}
          <div className="ar-toolbar">
            <button className="sa-tool-btn" onClick={expandAll}>
              Expand All
            </button>
            <button className="sa-tool-btn" onClick={collapseAll}>
              Collapse All
            </button>
            <span className="ar-toolbar-info">
              Click a segment to expand its assets
            </span>
          </div>

          {/* Segments */}
          <div className="ar-segments">
            {segments.map((seg) => {
              const idx = Number(seg.index ?? 0);
              const isExpanded = expanded.has(idx);
              const clips = (seg.resolvedClips ?? []) as AnyRecord[];
              const quotes = (seg.resolvedQuotes ?? []) as AnyRecord[];
              const images = (seg.resolvedImages ?? []) as AnyRecord[];
              const receipts = (seg.resolvedReceipts ?? []) as AnyRecord[];
              const stocks = (seg.resolvedStocks ?? []) as AnyRecord[];
              const reactions = (seg.reactionPosts ?? []) as AnyRecord[];
              const assetCount = countAssets(seg);

              return (
                <div
                  key={idx}
                  className={`ar-segment${isExpanded ? " ar-segment-open" : ""}`}
                >
                  <button
                    className="ar-segment-header"
                    onClick={() => toggle(idx)}
                    type="button"
                  >
                    <span className="ar-seg-idx">#{idx + 1}</span>
                    <span className="ar-seg-time">{S(seg.timeLabel)}</span>
                    <span className="ar-seg-beat">{S(seg.beatSummary)}</span>
                    <div className="ar-seg-tags">
                      {clips.length > 0 && (
                        <span className="ar-seg-tag ar-tag-clip">
                          {clips.length} clips
                        </span>
                      )}
                      {quotes.length > 0 && (
                        <span className="ar-seg-tag ar-tag-quote">
                          {quotes.length} quotes
                        </span>
                      )}
                      {images.length > 0 && (
                        <span className="ar-seg-tag ar-tag-image">
                          {images.length} images
                        </span>
                      )}
                      {receipts.length > 0 && (
                        <span className="ar-seg-tag ar-tag-receipt">
                          {receipts.length} receipts
                        </span>
                      )}
                      {stocks.length > 0 && (
                        <span className="ar-seg-tag ar-tag-stock">
                          {stocks.length} stock
                        </span>
                      )}
                      {reactions.length > 0 && (
                        <span className="ar-seg-tag ar-tag-reaction">
                          {reactions.length} reactions
                        </span>
                      )}
                      {assetCount === 0 && (
                        <span className="ar-seg-tag">no assets</span>
                      )}
                    </div>
                    <span className="ar-seg-arrow">
                      {isExpanded ? "\u25BE" : "\u25B8"}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="ar-segment-body">
                      {/* Script text */}
                      <div className="ar-script-text">{S(seg.scriptText)}</div>

                      {/* Editor note */}
                      {seg.editorNote ? (
                        <div className="ar-editor-note">
                          {S(seg.editorNote)}
                        </div>
                      ) : null}

                      {/* Agent summary */}
                      {seg.agentSummary ? (
                        <div className="ar-agent-summary">
                          {S(seg.agentSummary)}
                        </div>
                      ) : null}

                      {/* People & orgs */}
                      {(((seg.people as string[]) ?? []).length > 0 ||
                        ((seg.orgs as string[]) ?? []).length > 0) && (
                        <div className="ar-entities">
                          {((seg.people as string[]) ?? []).map((p, i) => (
                            <span key={`p${i}`} className="ar-entity ar-entity-person">{p}</span>
                          ))}
                          {((seg.orgs as string[]) ?? []).map((o, i) => (
                            <span key={`o${i}`} className="ar-entity ar-entity-org">{o}</span>
                          ))}
                        </div>
                      )}

                      {/* Asset groups */}
                      <div className="ar-assets">
                        {clips.length > 0 && (
                          <AssetGroup label="Clips" items={clips} kind="clip" />
                        )}
                        {quotes.length > 0 && (
                          <AssetGroup label="Quotes" items={quotes} kind="quote" />
                        )}
                        {images.length > 0 && (
                          <AssetGroup label="Images" items={images} kind="image" />
                        )}
                        {receipts.length > 0 && (
                          <AssetGroup label="Receipts" items={receipts} kind="receipt" />
                        )}
                        {stocks.length > 0 && (
                          <AssetGroup label="Stock Footage" items={stocks} kind="stock" />
                        )}
                        {reactions.length > 0 && (
                          <AssetGroup label="Reactions" items={reactions} kind="reaction" />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {segments.length === 0 && (
            <div className="ar-empty">
              <div className="ar-empty-icon">&#9674;</div>
              <div className="ar-empty-text">
                No segments in this asset report
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function AssetGroup({
  label,
  items,
  kind,
}: {
  label: string;
  items: AnyRecord[];
  kind: string;
}) {
  return (
    <div className="ar-asset-group">
      <div className="ar-group-label">{label} ({items.length})</div>
      <div className="ar-group-items">
        {items.map((item, i) => (
          <AssetCard key={i} item={item} kind={kind} />
        ))}
      </div>
    </div>
  );
}

function AssetCard({ item, kind }: { item: AnyRecord; kind: string }) {
  const url =
    S(item.sourceUrl) || S(item.imageUrl) || S(item.url) || S(item.postUrl);
  const isLink = url && url !== "#";

  const content = (
    <>
      {kind === "quote" ? (
        <>
          <div className="ar-card-quote">
            &ldquo;{S(item.quoteText)}&rdquo;
          </div>
          <div className="ar-card-meta">
            {item.speaker ? `\u2014 ${S(item.speaker)} \u00B7 ` : ""}
            {S(item.videoTitle)}
          </div>
        </>
      ) : kind === "reaction" ? (
        <>
          <div className="ar-card-quote">
            &ldquo;{S(item.text)}&rdquo;
          </div>
          <div className="ar-card-meta">
            @{S(item.username)} \u00B7 {S(item.displayName)}
          </div>
        </>
      ) : (
        <>
          <div className="ar-card-title">
            {S(item.title) || S(item.query) || "Untitled"}
          </div>
          <div className="ar-card-meta">
            {kind === "clip" && (
              <>
                {S(item.provider)}
                {item.channelOrContributor
                  ? ` \u00B7 ${S(item.channelOrContributor)}`
                  : ""}
                {Number(item.viewCount) > 0
                  ? ` \u00B7 ${Number(item.viewCount).toLocaleString()} views`
                  : ""}
              </>
            )}
            {kind === "image" && S(item.source)}
            {kind === "receipt" && S(item.snippet)}
            {kind === "stock" && S(item.provider)}
          </div>
          {Number(item.relevanceScore) > 0 && (
            <div className="ar-card-score">
              relevance: {Number(item.relevanceScore).toFixed(1)}
            </div>
          )}
        </>
      )}
    </>
  );

  if (isLink) {
    return (
      <a
        className={`ar-card ar-card-${kind}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {content}
      </a>
    );
  }

  return <div className={`ar-card ar-card-${kind}`}>{content}</div>;
}

const styles = `
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

/* Asset report */
.ar-toolbar { display: flex; align-items: center; gap: 8px; padding: 14px 0; }
.ar-toolbar-info { font-size: 10px; color: #333; margin-left: auto; }

.ar-segments { display: flex; flex-direction: column; gap: 4px; }

.ar-segment { border: 1px solid #151515; border-radius: 4px; overflow: hidden; background: #0c0c0c; }
.ar-segment-open { border-color: #222; }

.ar-segment-header { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 16px; background: transparent; border: none; color: inherit; font-family: inherit; font-size: 11px; cursor: pointer; text-align: left; transition: background 0.1s; }
.ar-segment-header:hover { background: #111; }

.ar-seg-idx { flex-shrink: 0; width: 28px; font-size: 10px; font-weight: 700; color: #333; }
.ar-seg-time { flex-shrink: 0; width: 70px; color: #7dc; font-weight: 600; font-size: 10px; }
.ar-seg-beat { flex: 1; color: #999; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ar-seg-tags { display: flex; gap: 4px; flex-shrink: 0; }
.ar-seg-tag { font-size: 8px; padding: 2px 6px; border-radius: 2px; background: #151515; color: #555; text-transform: uppercase; letter-spacing: 0.3px; }
.ar-tag-clip { background: #0f1a2a; color: #68a; }
.ar-tag-quote { background: #1a1a0f; color: #c9c96a; }
.ar-tag-image { background: #1a0f1a; color: #a68a; }
.ar-tag-receipt { background: #1a120a; color: #c93; }
.ar-tag-stock { background: #0a1a12; color: #5b9; }
.ar-tag-reaction { background: #1a0a0a; color: #a66; }
.ar-seg-arrow { flex-shrink: 0; color: #333; font-size: 10px; width: 14px; text-align: center; }

.ar-segment-body { padding: 16px 20px; border-top: 1px solid #151515; }

.ar-script-text { font-size: 12px; line-height: 1.8; color: #888; white-space: pre-wrap; margin-bottom: 14px; padding: 12px 16px; background: #0a0a0a; border: 1px solid #131313; border-radius: 3px; }

.ar-editor-note { font-size: 10px; color: #c93; background: #1a1208; padding: 8px 12px; border-radius: 3px; margin-bottom: 12px; border-left: 2px solid #c93; line-height: 1.5; }

.ar-agent-summary { font-size: 10px; color: #68a; background: #0a1018; padding: 8px 12px; border-radius: 3px; margin-bottom: 12px; border-left: 2px solid #68a; line-height: 1.5; }

.ar-entities { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px; }
.ar-entity { font-size: 9px; padding: 2px 8px; border-radius: 2px; }
.ar-entity-person { background: #0f1a2a; color: #68a; border: 1px solid #1a2a3a; }
.ar-entity-org { background: #1a0f2a; color: #86a; border: 1px solid #2a1a3a; }

.ar-assets { display: flex; flex-direction: column; gap: 16px; }

.ar-asset-group { }
.ar-group-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #444; margin-bottom: 8px; }
.ar-group-items { display: flex; flex-direction: column; gap: 3px; }

.ar-card { display: flex; flex-direction: column; gap: 3px; padding: 8px 12px; background: #111; border: 1px solid #181818; border-radius: 3px; text-decoration: none; color: inherit; transition: background 0.1s; }
a.ar-card:hover { background: #161616; }
.ar-card-clip { border-left: 2px solid #68a; }
.ar-card-quote { border-left: 2px solid #c9c96a; }
.ar-card-image { border-left: 2px solid #a68a; }
.ar-card-receipt { border-left: 2px solid #c93; }
.ar-card-stock { border-left: 2px solid #5b9; }
.ar-card-reaction { border-left: 2px solid #a66; }

.ar-card-title { font-size: 11px; color: #bbb; }
.ar-card-quote { font-size: 11px; color: #ddb; font-style: italic; line-height: 1.6; }
.ar-card-meta { font-size: 9px; color: #555; }
.ar-card-score { font-size: 9px; color: #5b9; margin-top: 2px; }

.ar-empty { text-align: center; padding: 60px 20px; color: #333; }
.ar-empty-icon { font-size: 28px; margin-bottom: 10px; }
.ar-empty-text { font-size: 12px; }

@media (max-width: 900px) {
  .ar-seg-tags { display: none; }
}
`;
