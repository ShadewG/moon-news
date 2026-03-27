import Link from "next/link";
import { notFound } from "next/navigation";

import type { MoonAnalysisRun } from "@/lib/moon-analysis";
import { getMoonAnalysisRun } from "@/server/services/moon-analysis";

import MoonAnalysisRunStatusClient from "./run-status-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

function formatTimestamp(value: string | null) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function scopeLabel(run: MoonAnalysisRun) {
  if (run.scopeType === "monthly") return "Monthly cohort";
  if (run.scopeType === "weekly") return "Weekly cohort";
  return "Single-video deep dive";
}

function scopeBadgeClass(run: MoonAnalysisRun) {
  if (run.scopeType === "video") return "sa-badge-amber";
  if (run.scopeType === "weekly") return "sa-badge-blue";
  return "sa-badge-muted";
}

function statusBadgeClass(status: string) {
  if (status === "complete") return "sa-badge-green";
  if (status === "failed") return "sa-badge-red";
  return "sa-badge-amber";
}

function statusMessage(run: MoonAnalysisRun) {
  if (run.status === "complete")
    return "The report is ready. Review it inline below or open the full HTML view in a new tab.";
  if (run.status === "failed")
    return run.errorText ?? "This run failed before the report was rendered.";
  if (run.status === "needs_review")
    return "This run completed with a report that should be reviewed before treating it as final.";
  return "This page refreshes automatically every 10 seconds while the agent is still running.";
}

function requestSummary(run: MoonAnalysisRun) {
  if (run.scopeType === "video" && run.youtubeVideoTitle)
    return `Targeting ${run.youtubeVideoTitle}.`;
  if (run.scopeType === "video" && run.youtubeVideoId)
    return `Targeting YouTube video ${run.youtubeVideoId}.`;
  if (run.scopeType === "monthly")
    return "Analyzing Moon's latest month of long-form uploads, retention, and transcript patterns.";
  return "Analyzing Moon's latest week of long-form uploads, retention, and transcript patterns.";
}

export default async function MoonAnalysisRunPage(props: PageProps) {
  const { runId } = await props.params;
  const run = await getMoonAnalysisRun(runId);

  if (!run) notFound();

  const reportUrl = `/moon-analysis/${run.id}/report`;
  const hasReport = run.status === "complete" && Boolean(run.reportHtml);
  const result = run.result;

  return (
    <>
      <style>{styles}</style>
      <div className="sa-root">
        <MoonAnalysisRunStatusClient status={run.status} />

        {/* Header */}
        <header className="sa-header">
          <Link href="/moon-analysis" className="sa-back">
            &larr; All Runs
          </Link>
          <div className="sa-header-main">
            <div className="sa-header-left">
              <h1 className="sa-title">
                {run.label ?? "Moon analysis"}
              </h1>
              <div className="sa-header-meta">
                <span className={`sa-badge ${scopeBadgeClass(run)}`}>
                  {run.scopeType}
                </span>
                <span className={`sa-badge ${statusBadgeClass(run.status)}`}>
                  {run.status.replace(/_/g, " ")}
                </span>
                <span className="sa-meta-text">
                  {scopeLabel(run)}
                </span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">
                  {run.scopeStartDate} to {run.scopeEndDate}
                </span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">
                  Created {formatTimestamp(run.createdAt)}
                </span>
                {run.youtubeVideoTitle && (
                  <>
                    <span className="sa-meta-sep">|</span>
                    <span className="sa-meta-text sa-meta-accent">
                      {run.youtubeVideoTitle}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="sa-content">
          {/* Status message */}
          <div
            className={`ma-status-msg${run.status === "failed" ? " ma-status-failed" : ""}`}
          >
            {statusMessage(run)}
          </div>

          {/* Info cards */}
          <div className="ma-grid">
            <div className="ma-card">
              <div className="ma-card-label">Run Status</div>
              <div className="ma-card-row">
                <span className="ma-card-key">Started</span>
                <span className="ma-card-val">{formatTimestamp(run.startedAt)}</span>
              </div>
              <div className="ma-card-row">
                <span className="ma-card-key">Completed</span>
                <span className="ma-card-val">{formatTimestamp(run.completedAt)}</span>
              </div>
              <div className="ma-card-row">
                <span className="ma-card-key">Artifacts</span>
                <span className="ma-card-val">{run.artifactDir ?? "pending"}</span>
              </div>
            </div>

            <div className="ma-card">
              <div className="ma-card-label">Analysis Scope</div>
              <div className="ma-card-text">{requestSummary(run)}</div>
              {run.request.notes ? (
                <>
                  <div className="ma-card-sublabel">Operator notes</div>
                  <div className="ma-card-text">{run.request.notes}</div>
                </>
              ) : (
                <div className="ma-card-text ma-card-dim">
                  No operator notes were supplied for this run.
                </div>
              )}
            </div>
          </div>

          {/* Result summary */}
          {result && (
            <>
              {/* Key takeaways */}
              <div className="ma-section">
                <div className="ma-card-label">Top Read</div>
                <div className="ma-dek">{result.dek}</div>
                <div className="ma-takeaways">
                  {result.keyTakeaways.slice(0, 4).map((item, i) => (
                    <div key={i} className="ma-takeaway">{item}</div>
                  ))}
                </div>
              </div>

              {/* Numbers that matter */}
              {result.numbersThatMatter.length > 0 && (
                <div className="ma-section">
                  <div className="ma-card-label">Numbers That Matter</div>
                  <div className="ma-numbers">
                    {result.numbersThatMatter.map((n, i) => (
                      <div key={i} className="ma-number-card">
                        <div className="ma-number-value">{n.value}</div>
                        <div className="ma-number-label">{n.label}</div>
                        {n.note && <div className="ma-number-note">{n.note}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Target diagnosis */}
              {result.targetDiagnosis && (
                <div className="ma-section">
                  <div className="ma-card-label">Target Diagnosis</div>
                  <div className="ma-diagnosis-title">{result.targetDiagnosis.title}</div>
                  <div className="ma-card-text">{result.targetDiagnosis.summary}</div>
                  <ul className="ma-diagnosis-bullets">
                    {result.targetDiagnosis.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Transcript findings */}
              {result.transcriptFindings.length > 0 && (
                <div className="ma-section">
                  <div className="ma-card-label">Transcript Findings ({result.transcriptFindings.length})</div>
                  <div className="ma-findings">
                    {result.transcriptFindings.map((f, i) => (
                      <div key={i} className="ma-finding">
                        <div className="ma-finding-heading">{f.heading}</div>
                        <div className="ma-finding-body">{f.body}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Retention findings */}
              {result.retentionFindings.length > 0 && (
                <div className="ma-section">
                  <div className="ma-card-label">Retention Findings ({result.retentionFindings.length})</div>
                  <div className="ma-findings">
                    {result.retentionFindings.map((f, i) => (
                      <div key={i} className="ma-finding">
                        <div className="ma-finding-heading">{f.heading}</div>
                        <div className="ma-finding-body">{f.body}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Winner patterns */}
              {result.winnerPatterns.length > 0 && (
                <div className="ma-section">
                  <div className="ma-card-label">Winner Patterns ({result.winnerPatterns.length})</div>
                  <div className="ma-findings">
                    {result.winnerPatterns.map((f, i) => (
                      <div key={i} className="ma-finding">
                        <div className="ma-finding-heading">{f.heading}</div>
                        <div className="ma-finding-body">{f.body}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Idea directions */}
              {result.ideaDirections.length > 0 && (
                <div className="ma-section">
                  <div className="ma-card-label">Idea Directions ({result.ideaDirections.length})</div>
                  <div className="ma-ideas">
                    {result.ideaDirections.map((idea, i) => (
                      <div key={i} className="ma-idea">
                        <div className="ma-idea-title">{idea.title}</div>
                        <div className="ma-idea-why">{idea.whyNow}</div>
                        <div className="ma-idea-evidence">{idea.evidence}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cohort rows */}
              {result.cohortRows.length > 0 && (
                <div className="ma-section">
                  <div className="ma-card-label">Cohort Performance ({result.cohortRows.length})</div>
                  <div className="ma-table-wrap">
                    <table className="ma-table">
                      <thead>
                        <tr>
                          <th>Video</th>
                          <th>Views</th>
                          <th>Avg View %</th>
                          <th>Net Subs</th>
                          <th>Watch Hours</th>
                          <th>Verdict</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.cohortRows.map((row, i) => (
                          <tr key={i}>
                            <td className="ma-table-title">{row.title}</td>
                            <td>{row.viewsLabel}</td>
                            <td>{row.avgViewPctLabel}</td>
                            <td>{row.netSubscribersLabel}</td>
                            <td>{row.watchHoursLabel}</td>
                            <td>{row.verdict}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Report iframe */}
          {hasReport && (
            <div className="ma-section">
              <div className="ma-section-header">
                <div className="ma-card-label">HTML Report</div>
                <Link href={reportUrl} className="ma-open-link" target="_blank">
                  Open in new tab &rarr;
                </Link>
              </div>
              <div className="ma-report-frame-shell">
                <iframe
                  title={run.label ?? "Moon analysis report"}
                  src={reportUrl}
                  className="ma-report-frame"
                />
              </div>
            </div>
          )}

          {/* Developer details */}
          <details className="ma-details">
            <summary className="ma-summary">Developer details</summary>
            <div className="ma-debug-grid">
              <div className="ma-card">
                <div className="ma-card-label">Request JSON</div>
                <pre className="ma-pre">{JSON.stringify(run.request, null, 2)}</pre>
              </div>
              {result && (
                <div className="ma-card ma-card-full">
                  <div className="ma-card-label">Result JSON</div>
                  <pre className="ma-pre">{JSON.stringify(result, null, 2)}</pre>
                </div>
              )}
              {run.errorText && (
                <div className="ma-card ma-card-full">
                  <div className="ma-card-label">Error</div>
                  <pre className="ma-pre ma-pre-error">{run.errorText}</pre>
                </div>
              )}
            </div>
          </details>
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
.sa-badge-red { background: #2a0f0f; color: #a44; }
.sa-badge-blue { background: #0f1a2a; color: #68a; }
.sa-badge-amber { background: #1a1a0f; color: #c93; }
.sa-badge-muted { background: #181818; color: #555; }
.sa-content { padding: 16px 24px 32px; max-width: 1100px; }

/* Status message */
.ma-status-msg { padding: 10px 14px; background: #0c0c0c; border: 1px solid #151515; border-radius: 4px; margin-bottom: 16px; font-size: 11px; line-height: 1.6; color: #888; }
.ma-status-failed { border-color: #2a1515; color: #a44; background: #120a0a; }

/* Grid and cards */
.ma-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.ma-card { background: #0c0c0c; border: 1px solid #151515; border-radius: 4px; padding: 14px 16px; }
.ma-card-full { grid-column: 1 / -1; }
.ma-card-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #444; margin-bottom: 10px; }
.ma-card-sublabel { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #5b9; margin: 12px 0 6px; }
.ma-card-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #111; font-size: 10px; }
.ma-card-row:last-child { border-bottom: none; }
.ma-card-key { color: #444; }
.ma-card-val { color: #999; }
.ma-card-text { font-size: 11px; line-height: 1.6; color: #888; margin-bottom: 6px; }
.ma-card-dim { color: #444; }

/* Sections */
.ma-section { background: #0c0c0c; border: 1px solid #151515; border-radius: 4px; padding: 16px 20px; margin-bottom: 12px; }
.ma-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.ma-section-header .ma-card-label { margin-bottom: 0; }
.ma-open-link { font-size: 10px; color: #68a; text-decoration: none; padding: 3px 10px; border: 1px solid #1a2a3a; border-radius: 3px; transition: all 0.12s; }
.ma-open-link:hover { background: #0f1a2a; color: #8fb4ff; }

/* Dek */
.ma-dek { font-size: 13px; line-height: 1.8; color: #bbb; margin-bottom: 14px; }

/* Takeaways */
.ma-takeaways { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }
.ma-takeaway { padding: 10px 14px; background: #0a0a0a; border: 1px solid #181818; border-radius: 3px; font-size: 11px; line-height: 1.6; color: #999; border-left: 2px solid #5b9; }

/* Numbers */
.ma-numbers { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
.ma-number-card { padding: 12px 14px; background: #0a0a0a; border: 1px solid #181818; border-radius: 3px; text-align: center; }
.ma-number-value { font-size: 22px; font-weight: 700; color: #ccc; letter-spacing: -1px; margin-bottom: 4px; }
.ma-number-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #555; margin-bottom: 4px; }
.ma-number-note { font-size: 10px; color: #5b9; }

/* Target diagnosis */
.ma-diagnosis-title { font-size: 14px; font-weight: 600; color: #ccc; margin-bottom: 8px; }
.ma-diagnosis-bullets { padding-left: 18px; margin: 8px 0 0; }
.ma-diagnosis-bullets li { font-size: 11px; color: #999; line-height: 1.6; margin-bottom: 4px; }

/* Findings */
.ma-findings { display: flex; flex-direction: column; gap: 8px; }
.ma-finding { padding: 10px 14px; background: #0a0a0a; border: 1px solid #181818; border-radius: 3px; }
.ma-finding-heading { font-size: 12px; font-weight: 600; color: #ccc; margin-bottom: 6px; }
.ma-finding-body { font-size: 11px; line-height: 1.7; color: #888; }

/* Ideas */
.ma-ideas { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
.ma-idea { padding: 12px 14px; background: #0a0a0a; border: 1px solid #181818; border-radius: 3px; }
.ma-idea-title { font-size: 12px; font-weight: 600; color: #ccc; margin-bottom: 6px; }
.ma-idea-why { font-size: 10px; color: #c93; margin-bottom: 6px; }
.ma-idea-evidence { font-size: 10px; color: #666; line-height: 1.5; }

/* Table */
.ma-table-wrap { overflow-x: auto; }
.ma-table { width: 100%; border-collapse: collapse; font-size: 10px; }
.ma-table th { text-align: left; padding: 6px 10px; border-bottom: 1px solid #1a1a1a; color: #444; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; font-size: 9px; }
.ma-table td { padding: 6px 10px; border-bottom: 1px solid #111; color: #888; }
.ma-table-title { color: #bbb; font-weight: 500; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Report iframe */
.ma-report-frame-shell { border: 1px solid #181818; border-radius: 3px; overflow: hidden; background: #0a0a0a; }
.ma-report-frame { display: block; width: 100%; min-height: 80vh; border: 0; background: #0a0a0a; }

/* Debug / developer details */
.ma-details { background: #0c0c0c; border: 1px solid #151515; border-radius: 4px; padding: 14px 16px; margin-top: 12px; }
.ma-summary { cursor: pointer; color: #555; font-size: 11px; font-weight: 600; }
.ma-summary:hover { color: #999; }
.ma-debug-grid { display: grid; gap: 12px; grid-template-columns: 1fr; margin-top: 14px; }
.ma-pre { margin: 0; overflow-x: auto; padding: 12px 14px; background: #0a0a0a; border: 1px solid #181818; border-radius: 3px; color: #888; font-size: 10px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; font-family: 'IBM Plex Mono', ui-monospace, monospace; }
.ma-pre-error { color: #a44; }

@media (max-width: 700px) {
  .ma-grid { grid-template-columns: 1fr; }
}
`;
