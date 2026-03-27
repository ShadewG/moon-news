"use client";

import Link from "next/link";
import { useState } from "react";

interface ResearchData {
  summary?: string;
  timeline?: Array<{ date: string; event: string }>;
  key_players?: Array<{ name: string; role: string }>;
  controversy_score?: number;
  format_suggestion?: string;
  angle_suggestions?: string[];
  title_options?: string[];
  script_opener?: string;
}

interface SourceRef {
  title: string;
  url: string;
  source?: string;
}

interface Props {
  storyId: string;
  title: string;
  vertical: string | null;
  research: ResearchData;
  model: string | null;
  meta: {
    mode: string;
    searchResultCount: number;
    extractedCount: number;
    sources: SourceRef[];
  };
  createdAt: string;
  updatedAt: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ResearchDetailClient({
  title,
  research,
  model,
  meta,
  createdAt,
  updatedAt,
}: Props) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyText = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const score = research.controversy_score ?? 0;
  const scoreColor = score >= 70 ? "#a44" : score >= 40 ? "#c93" : "#5b9";

  return (
    <>
      <style>{styles}</style>
      <div className="sa-root">
        <header className="sa-header">
          <Link href="/script-lab?tab=research" className="sa-back">
            &larr; Generate
          </Link>
          <div className="sa-header-main">
            <div className="sa-header-left">
              <h1 className="sa-title">{title}</h1>
              <div className="sa-header-meta">
                <span className="sa-badge sa-badge-blue">deep research</span>
                <span className="sa-badge sa-badge-muted">{meta.mode}</span>
                <span className="sa-meta-text">
                  {formatDate(createdAt)} at {formatTime(createdAt)}
                </span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">
                  {meta.searchResultCount} sources found
                </span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">
                  {meta.extractedCount} extracted
                </span>
                {model && (
                  <>
                    <span className="sa-meta-sep">|</span>
                    <span className="sa-meta-text sa-meta-accent">{model}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="sa-content">
          <div className="rd-layout">
            {/* Main column */}
            <div className="rd-main">
              {/* Summary */}
              {research.summary && (
                <div className="rd-card">
                  <div className="rd-card-header">
                    <span className="sa-sidebar-label">Summary</span>
                    <button
                      className="rd-copy-btn"
                      onClick={() => copyText(research.summary!, "summary")}
                    >
                      {copiedField === "summary" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="rd-summary">{research.summary}</div>
                </div>
              )}

              {/* Timeline */}
              {research.timeline && research.timeline.length > 0 && (
                <div className="rd-card">
                  <span className="sa-sidebar-label">
                    Timeline ({research.timeline.length})
                  </span>
                  <div className="rd-timeline">
                    {research.timeline.map((t, i) => (
                      <div key={i} className="rd-timeline-item">
                        <div className="rd-timeline-dot" />
                        <div className="rd-timeline-date">{t.date}</div>
                        <div className="rd-timeline-event">{t.event}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Script Opener */}
              {research.script_opener && (
                <div className="rd-card">
                  <div className="rd-card-header">
                    <span className="sa-sidebar-label">Script Opener</span>
                    <button
                      className="rd-copy-btn"
                      onClick={() =>
                        copyText(research.script_opener!, "opener")
                      }
                    >
                      {copiedField === "opener" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="rd-opener">{research.script_opener}</div>
                </div>
              )}

              {/* Sources */}
              {meta.sources.length > 0 && (
                <div className="rd-card">
                  <span className="sa-sidebar-label">
                    Sources ({meta.sources.length})
                  </span>
                  <div className="rd-sources">
                    {meta.sources.map((s, i) => (
                      <a
                        key={i}
                        className="rd-source-item"
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="rd-source-title">{s.title}</span>
                        {s.source && (
                          <span className="rd-source-site">{s.source}</span>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <aside className="rd-sidebar">
              {/* Score */}
              <div className="sa-sidebar-card">
                <span className="sa-sidebar-label">Controversy Score</span>
                <div className="rd-score-ring">
                  <span className="rd-score-value" style={{ color: scoreColor }}>
                    {score}
                  </span>
                  <span className="rd-score-max">/100</span>
                </div>
                {research.format_suggestion && (
                  <div className="rd-format">
                    <span className="rd-format-label">Format:</span>{" "}
                    <span className="rd-format-value">
                      {research.format_suggestion}
                    </span>
                  </div>
                )}
              </div>

              {/* Key Players */}
              {research.key_players && research.key_players.length > 0 && (
                <div className="sa-sidebar-card">
                  <span className="sa-sidebar-label">
                    Key Players ({research.key_players.length})
                  </span>
                  <div className="rd-players">
                    {research.key_players.map((p, i) => (
                      <div key={i} className="rd-player">
                        <div className="rd-player-name">{p.name}</div>
                        <div className="rd-player-role">{p.role}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested Angles */}
              {research.angle_suggestions &&
                research.angle_suggestions.length > 0 && (
                  <div className="sa-sidebar-card">
                    <span className="sa-sidebar-label">
                      Suggested Angles ({research.angle_suggestions.length})
                    </span>
                    <div className="rd-angles">
                      {research.angle_suggestions.map((a, i) => (
                        <div key={i} className="rd-angle-item">
                          <span className="rd-angle-num">{i + 1}.</span>
                          <span className="rd-angle-text">{a}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Title Options */}
              {research.title_options && research.title_options.length > 0 && (
                <div className="sa-sidebar-card">
                  <div className="rd-card-header">
                    <span className="sa-sidebar-label">
                      Title Options ({research.title_options.length})
                    </span>
                    <button
                      className="rd-copy-btn"
                      onClick={() =>
                        copyText(
                          research.title_options!.join("\n"),
                          "titles"
                        )
                      }
                    >
                      {copiedField === "titles" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="rd-titles">
                    {research.title_options.map((t, i) => (
                      <div key={i} className="rd-title-item">
                        {t}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Meta */}
              <div className="sa-sidebar-card">
                <span className="sa-sidebar-label">Research Meta</span>
                <div className="rd-meta-list">
                  <div className="rd-meta-row">
                    <span className="rd-meta-key">Mode</span>
                    <span className="rd-meta-val">{meta.mode}</span>
                  </div>
                  <div className="rd-meta-row">
                    <span className="rd-meta-key">Sources searched</span>
                    <span className="rd-meta-val">{meta.searchResultCount}</span>
                  </div>
                  <div className="rd-meta-row">
                    <span className="rd-meta-key">Extracted</span>
                    <span className="rd-meta-val">{meta.extractedCount}</span>
                  </div>
                  {model && (
                    <div className="rd-meta-row">
                      <span className="rd-meta-key">Model</span>
                      <span className="rd-meta-val">{model}</span>
                    </div>
                  )}
                  <div className="rd-meta-row">
                    <span className="rd-meta-key">Generated</span>
                    <span className="rd-meta-val">{formatDate(createdAt)}</span>
                  </div>
                  {updatedAt !== createdAt && (
                    <div className="rd-meta-row">
                      <span className="rd-meta-key">Updated</span>
                      <span className="rd-meta-val">{formatDate(updatedAt)}</span>
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </main>
      </div>
    </>
  );
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
.sa-sidebar-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #444; display: block; margin-bottom: 10px; }
.sa-sidebar-card { background: #0c0c0c; border: 1px solid #151515; border-radius: 4px; padding: 14px 16px; }

/* Research detail layout */
.rd-layout { display: grid; grid-template-columns: 1fr 340px; gap: 20px; align-items: start; padding-top: 16px; }
.rd-main { display: flex; flex-direction: column; gap: 12px; }
.rd-sidebar { display: flex; flex-direction: column; gap: 12px; }
.rd-card { background: #0c0c0c; border: 1px solid #151515; border-radius: 4px; padding: 16px 20px; }
.rd-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0; }
.rd-card-header .sa-sidebar-label { margin-bottom: 0; }

.rd-copy-btn { font-family: inherit; font-size: 9px; padding: 3px 10px; border-radius: 2px; border: 1px solid #1a1a1a; background: #0c0c0c; color: #555; cursor: pointer; transition: all 0.12s; text-transform: uppercase; letter-spacing: 0.5px; }
.rd-copy-btn:hover { background: #151515; color: #999; border-color: #333; }

/* Summary */
.rd-summary { font-size: 13px; line-height: 1.9; color: #bbb; white-space: pre-wrap; margin-top: 12px; }

/* Timeline */
.rd-timeline { display: flex; flex-direction: column; gap: 0; }
.rd-timeline-item { display: grid; grid-template-columns: 14px 110px 1fr; gap: 8px; padding: 10px 0; border-bottom: 1px solid #111; align-items: start; }
.rd-timeline-item:last-child { border-bottom: none; }
.rd-timeline-dot { width: 6px; height: 6px; border-radius: 50%; background: #68a; margin-top: 4px; }
.rd-timeline-date { font-size: 11px; color: #7dc; font-weight: 500; }
.rd-timeline-event { font-size: 11px; color: #999; line-height: 1.6; }

/* Script opener */
.rd-opener { font-size: 13px; line-height: 1.9; color: #bbb; white-space: pre-wrap; margin-top: 12px; padding: 16px 20px; background: #0a0a0a; border: 1px solid #181818; border-radius: 3px; border-left: 3px solid #5b9; font-style: italic; }

/* Sources */
.rd-sources { display: flex; flex-direction: column; gap: 4px; }
.rd-source-item { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; background: #111; border: 1px solid #181818; border-radius: 3px; text-decoration: none; color: inherit; transition: background 0.1s; }
.rd-source-item:hover { background: #161616; }
.rd-source-title { font-size: 11px; color: #8fb4ff; }
.rd-source-site { font-size: 9px; color: #444; }

/* Score ring */
.rd-score-ring { display: flex; align-items: baseline; gap: 2px; margin-bottom: 10px; }
.rd-score-value { font-size: 32px; font-weight: 700; letter-spacing: -1px; }
.rd-score-max { font-size: 14px; color: #333; }

/* Format */
.rd-format { font-size: 10px; color: #666; padding-top: 6px; border-top: 1px solid #151515; }
.rd-format-label { color: #444; }
.rd-format-value { color: #5b9; font-weight: 600; }

/* Players */
.rd-players { display: flex; flex-direction: column; gap: 6px; }
.rd-player { padding: 8px 10px; background: #111; border: 1px solid #1a1a1a; border-radius: 3px; }
.rd-player-name { font-size: 11px; font-weight: 600; color: #ccc; margin-bottom: 2px; }
.rd-player-role { font-size: 10px; color: #666; line-height: 1.5; }

/* Angles */
.rd-angles { display: flex; flex-direction: column; gap: 6px; }
.rd-angle-item { display: flex; gap: 8px; font-size: 11px; line-height: 1.6; }
.rd-angle-num { color: #5b9; font-weight: 700; flex-shrink: 0; width: 16px; }
.rd-angle-text { color: #999; }

/* Titles */
.rd-titles { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.rd-title-item { padding: 8px 12px; background: #111; border: 1px solid #1a1a1a; border-radius: 3px; font-size: 12px; color: #ccc; line-height: 1.5; cursor: pointer; transition: background 0.1s; }
.rd-title-item:hover { background: #1a1a1a; }

/* Meta list */
.rd-meta-list { display: flex; flex-direction: column; gap: 0; }
.rd-meta-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #111; font-size: 10px; }
.rd-meta-row:last-child { border-bottom: none; }
.rd-meta-key { color: #444; }
.rd-meta-val { color: #999; }

@media (max-width: 900px) {
  .rd-layout { grid-template-columns: 1fr; }
}
`;
