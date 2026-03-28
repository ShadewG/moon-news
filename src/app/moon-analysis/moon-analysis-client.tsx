"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MoonAnalysisRun, MoonAnalysisScope } from "@/lib/moon-analysis";

/* ── helpers ── */

function ts(value: string) {
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function statusColor(s: string) {
  if (s === "complete" || s === "completed") return "var(--ma-green)";
  if (s === "failed") return "var(--ma-red)";
  if (s === "running" || s === "queued" || s === "pending") return "var(--ma-amber)";
  return "var(--ma-muted)";
}

/* ── types ── */

interface ScriptRun {
  job_id: number;
  status: string;
  step: string | null;
  model: string;
  preview: string;
  has_result: boolean;
  verdict: string | null;
  line_count: number | null;
  created_at: string | null;
}

interface ScriptJobPoll {
  job_id: number;
  status: string;
  step: string | null;
  result: ScriptReport | null;
  error: string | null;
}

interface ScriptLineReview {
  line_number: number;
  line_text: string;
  phase: string;
  action: string;
  rationale: string;
  recommended_revision: string | null;
  evidence: Array<{ video_id: string; title: string; note: string }>;
}

interface ScriptReport {
  coverage_note: string;
  overall_verdict: string;
  intro_verdict: string;
  strengths_to_keep: string[];
  global_risks: string[];
  rewrite_priorities: string[];
  line_reviews: ScriptLineReview[];
  suggested_intro_rewrite: string | null;
}

const STEP_LABELS: Record<string, string> = {
  queued: "Queued",
  loading_corpus: "Loading corpus",
  analyzing_script: "Analyzing script",
  done: "Done",
  error: "Failed",
};

/* ── ScriptResultsView ── */

function ScriptResultsView({ report, onClose }: { report: ScriptReport; onClose: () => void }) {
  const [openLines, setOpenLines] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpenLines((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const vc = report.overall_verdict === "strong" ? "var(--ma-green)" : report.overall_verdict === "weak" ? "var(--ma-red)" : "var(--ma-amber)";
  const vcBg = report.overall_verdict === "strong" ? "var(--ma-green-dim)" : report.overall_verdict === "weak" ? "var(--ma-red-dim)" : "var(--ma-amber-dim)";

  return (
    <div className="ma-panel" style={{ marginTop: 12 }}>
      {/* header */}
      <div className="ma-panel-head">
        <span className="ma-section-label">Script Doctor Results</span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="ma-badge" style={{ background: vcBg, color: vc }}>{report.overall_verdict}</span>
          <span className="ma-meta">{report.line_reviews.length} lines</span>
          <button type="button" className="ma-btn ma-btn-muted" onClick={onClose}>CLOSE</button>
        </div>
      </div>

      {/* coverage + intro */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--ma-border)" }}>
        <div className="ma-meta" style={{ marginBottom: 6 }}>{report.coverage_note}</div>
        <div style={{ color: "var(--ma-text)", fontSize: 11, lineHeight: 1.6 }}>{report.intro_verdict}</div>
        {report.suggested_intro_rewrite && (
          <div style={{ marginTop: 8, padding: "8px 10px", borderLeft: "2px solid var(--ma-green)", background: "var(--ma-green-dim)", fontSize: 11, color: "var(--ma-text)", lineHeight: 1.6, fontStyle: "italic", whiteSpace: "pre-wrap" }}>
            {report.suggested_intro_rewrite}
          </div>
        )}
      </div>

      {/* summary lists */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid var(--ma-border)" }}>
        {[
          { title: "STRENGTHS", items: report.strengths_to_keep, color: "var(--ma-green)" },
          { title: "RISKS", items: report.global_risks, color: "var(--ma-red)" },
          { title: "REWRITE PRIORITIES", items: report.rewrite_priorities, color: "var(--ma-amber)" },
        ].map((col) =>
          col.items.length > 0 ? (
            <div key={col.title} style={{ padding: "10px 14px", borderRight: "1px solid var(--ma-border)" }}>
              <div className="ma-section-label" style={{ color: col.color, marginBottom: 6 }}>{col.title}</div>
              {col.items.map((s, i) => (
                <div key={i} style={{ fontSize: 11, color: "var(--ma-text)", lineHeight: 1.5, padding: "2px 0", borderBottom: "1px solid var(--ma-border)" }}>{s}</div>
              ))}
            </div>
          ) : null
        )}
      </div>

      {/* line reviews */}
      {report.line_reviews.map((r, i) => {
        const isOpen = openLines.has(i);
        const phaseColor: Record<string, string> = { intro: "var(--ma-cyan)", early: "var(--ma-cyan)", mid: "var(--ma-muted2)", late: "var(--ma-amber)", ending: "var(--ma-purple)" };
        const actionColor: Record<string, string> = { keep: "var(--ma-green)", tighten: "var(--ma-amber)", rewrite: "#c87a4a", cut: "var(--ma-red)", move: "var(--ma-cyan)", add_proof: "var(--ma-cyan)", add_tension: "var(--ma-cyan)", expand: "var(--ma-cyan)" };
        const actionBg: Record<string, string> = { keep: "var(--ma-green-dim)", tighten: "var(--ma-amber-dim)", rewrite: "#2a1a0a", cut: "var(--ma-red-dim)", move: "var(--ma-cyan-dim)", add_proof: "var(--ma-cyan-dim)", add_tension: "var(--ma-cyan-dim)", expand: "var(--ma-cyan-dim)" };

        return (
          <div key={i} style={{ borderBottom: "1px solid var(--ma-border)", cursor: "pointer" }} onClick={() => toggle(i)}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 14px", fontSize: 11 }}>
              <span style={{ color: "var(--ma-muted)", minWidth: 22, textAlign: "right", flexShrink: 0 }}>{r.line_number}</span>
              <span className="ma-badge" style={{ background: "transparent", border: "1px solid", borderColor: phaseColor[r.phase] || "var(--ma-border)", color: phaseColor[r.phase] || "var(--ma-muted)", fontSize: 9, flexShrink: 0 }}>{r.phase}</span>
              <span className="ma-badge" style={{ background: actionBg[r.action] || "var(--ma-bg2)", color: actionColor[r.action] || "var(--ma-muted)", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{r.action}</span>
              <span style={{ flex: 1, color: "var(--ma-text)", lineHeight: 1.5, minWidth: 0 }}>{r.line_text}</span>
              <span style={{ color: "var(--ma-muted)", fontSize: 10, flexShrink: 0 }}>{isOpen ? "▾" : "▸"}</span>
            </div>
            {isOpen && (
              <div style={{ padding: "0 14px 10px 50px", fontSize: 11, lineHeight: 1.6 }} onClick={(e) => e.stopPropagation()}>
                {r.rationale && <><div className="ma-section-label" style={{ marginTop: 4 }}>WHY</div><div style={{ color: "var(--ma-text)" }}>{r.rationale}</div></>}
                {r.recommended_revision && <><div className="ma-section-label" style={{ marginTop: 6 }}>REVISION</div><div style={{ color: "var(--ma-green)", fontStyle: "italic", padding: "4px 8px", borderLeft: "2px solid var(--ma-green)", background: "var(--ma-green-dim)" }}>{r.recommended_revision}</div></>}
                {r.evidence.length > 0 && <><div className="ma-section-label" style={{ marginTop: 6 }}>EVIDENCE</div>{r.evidence.map((e, j) => <div key={j} style={{ color: "var(--ma-muted2)", fontSize: 10 }}>{e.title || e.video_id}{e.note ? ` — ${e.note}` : ""}</div>)}</>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── main ── */

export default function MoonAnalysisClient(props: { initialRuns: MoonAnalysisRun[] }) {
  const router = useRouter();
  const [videoId, setVideoId] = useState("");
  const [notes, setNotes] = useState("");
  const [pendingScope, setPendingScope] = useState<MoonAnalysisScope | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [scriptText, setScriptText] = useState("");
  const [scriptPending, setScriptPending] = useState(false);
  const [scriptStep, setScriptStep] = useState<string | null>(null);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [scriptReport, setScriptReport] = useState<ScriptReport | null>(null);
  const [scriptRuns, setScriptRuns] = useState<ScriptRun[]>([]);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runs = useMemo(() => props.initialRuns, [props.initialRuns]);

  useEffect(() => {
    fetch("/api/retention/analyze/recent").then((r) => r.ok ? r.json() : []).then((d: ScriptRun[]) => setScriptRuns(d)).catch(() => {});
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  /* moon runs */
  async function startRun(scope: MoonAnalysisScope) {
    setErrorText(null);
    setPendingScope(scope);
    try {
      const r = await fetch("/api/moon-analysis/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scopeType: scope, youtubeVideoId: scope === "video" ? videoId.trim() : undefined, notes: notes.trim() }) });
      const p = (await r.json()) as { runId?: string; error?: string };
      if (!r.ok || !p.runId) throw new Error(p.error ?? "Failed to create run.");
      startTransition(() => { router.push(`/moon-analysis/${p.runId}`); router.refresh(); });
    } catch (e) { setErrorText(e instanceof Error ? e.message : "Unknown error"); setPendingScope(null); }
  }

  /* script analysis */
  const poll = useCallback(async (id: number) => {
    try {
      const r = await fetch(`/api/retention/analyze/${id}`);
      if (!r.ok) { pollRef.current = setTimeout(() => poll(id), 3000); return; }
      const d: ScriptJobPoll = await r.json();
      if (d.status === "completed" && d.result) {
        setScriptPending(false); setScriptStep(null); setScriptReport(d.result);
        fetch("/api/retention/analyze/recent").then((r2) => r2.ok ? r2.json() : []).then((sr: ScriptRun[]) => setScriptRuns(sr)).catch(() => {});
        return;
      }
      if (d.status === "failed") { setScriptPending(false); setScriptStep(null); setScriptError(d.error?.slice(0, 200) ?? "Failed."); return; }
      setScriptStep(d.step ?? d.status);
      pollRef.current = setTimeout(() => poll(id), 2500);
    } catch { pollRef.current = setTimeout(() => poll(id), 3000); }
  }, []);

  async function startScript() {
    const t = scriptText.trim();
    if (!t) return;
    setScriptPending(true); setScriptError(null); setScriptReport(null); setScriptStep("queued");
    try {
      const r = await fetch("/api/retention/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script_text: t }) });
      const d = await r.json();
      if (!r.ok || !d.job_id) throw new Error(d.detail ?? "Failed to start.");
      setScriptStep(d.step ?? "queued");
      pollRef.current = setTimeout(() => poll(d.job_id), 2000);
    } catch (e) { setScriptPending(false); setScriptStep(null); setScriptError(e instanceof Error ? e.message : "Error"); }
  }

  async function viewResult(id: number) {
    const r = await fetch(`/api/retention/analyze/${id}`);
    if (!r.ok) return;
    const d: ScriptJobPoll = await r.json();
    if (d.result) setScriptReport(d.result);
  }

  /* merge & sort all runs */
  const allRuns = useMemo(() => {
    const out: Array<{ key: string; source: "moon" | "script"; time: string; moon?: MoonAnalysisRun; script?: ScriptRun }> = [];
    for (const r of runs) out.push({ key: `m-${r.id}`, source: "moon", time: r.createdAt, moon: r });
    for (const r of scriptRuns) out.push({ key: `s-${r.job_id}`, source: "script", time: r.created_at ?? "", script: r });
    out.sort((a, b) => (b.time || "").localeCompare(a.time || ""));
    return out;
  }, [runs, scriptRuns]);

  return (
    <div className="ma-root">
      {/* header */}
      <div className="ma-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="ma-title">Analysis</span>
          <span className="ma-meta">Moon Performance & Script Retention</span>
        </div>
      </div>

      {/* launcher */}
      <div className="ma-launchers">
        {/* perf analysis */}
        <div className="ma-panel">
          <div className="ma-panel-head">
            <span className="ma-section-label">Performance Analysis</span>
            <span className="ma-meta">Cohort or video deep dive</span>
          </div>
          <div style={{ padding: "10px 14px" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label className="ma-label">VIDEO ID</label>
                <input className="ma-input" value={videoId} onChange={(e) => setVideoId(e.target.value)} placeholder="tXrbg6LQ37w" />
              </div>
              <div style={{ flex: 2 }}>
                <label className="ma-label">NOTES</label>
                <input className="ma-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Focus areas, comparisons..." />
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="ma-btn ma-btn-cyan" onClick={() => startRun("monthly")} disabled={pendingScope !== null}>
                {pendingScope === "monthly" ? "STARTING..." : "MONTHLY"}
              </button>
              <button type="button" className="ma-btn ma-btn-blue" onClick={() => startRun("weekly")} disabled={pendingScope !== null}>
                {pendingScope === "weekly" ? "STARTING..." : "WEEKLY"}
              </button>
              <button type="button" className="ma-btn ma-btn-amber" onClick={() => startRun("video")} disabled={pendingScope !== null || videoId.trim().length !== 11}>
                {pendingScope === "video" ? "STARTING..." : "VIDEO"}
              </button>
            </div>
            {errorText && <div style={{ color: "var(--ma-red)", fontSize: 10, marginTop: 6 }}>{errorText}</div>}
          </div>
        </div>

        {/* script doctor */}
        <div className="ma-panel">
          <div className="ma-panel-head">
            <span className="ma-section-label">Script Doctor</span>
            <span className="ma-meta">Line-by-line retention feedback</span>
          </div>
          <div style={{ padding: "10px 14px" }}>
            <textarea className="ma-textarea" value={scriptText} onChange={(e) => setScriptText(e.target.value)} placeholder="Paste script here..." />
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
              <button type="button" className="ma-btn ma-btn-purple" onClick={startScript} disabled={scriptPending || !scriptText.trim()}>
                {scriptPending ? "ANALYZING..." : "ANALYZE"}
              </button>
              {scriptPending && scriptStep && (
                <span className="ma-meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="ma-pulse" />
                  {STEP_LABELS[scriptStep] ?? scriptStep}
                </span>
              )}
              {scriptError && <span style={{ color: "var(--ma-red)", fontSize: 10 }}>{scriptError}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* script results */}
      {scriptReport && <ScriptResultsView report={scriptReport} onClose={() => setScriptReport(null)} />}

      {/* recent runs */}
      <div className="ma-panel" style={{ marginTop: 12 }}>
        <div className="ma-panel-head">
          <span className="ma-section-label">Recent Runs</span>
          <span className="ma-meta">{allRuns.length} runs</span>
        </div>
        <table className="ma-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Description</th>
              <th>Status</th>
              <th>When</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {allRuns.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: "center", padding: 20, color: "var(--ma-muted)" }}>No runs yet</td></tr>
            )}
            {allRuns.map((row) => {
              if (row.source === "moon" && row.moon) {
                const r = row.moon;
                const typeColor = r.scopeType === "monthly" ? "var(--ma-cyan)" : r.scopeType === "weekly" ? "var(--ma-blue)" : "var(--ma-amber)";
                const typeBg = r.scopeType === "monthly" ? "var(--ma-cyan-dim)" : r.scopeType === "weekly" ? "var(--ma-blue-dim)" : "var(--ma-amber-dim)";
                const desc = r.youtubeVideoTitle ? `Target: ${r.youtubeVideoTitle}` : r.scopeType === "monthly" ? "Past-month cohort" : r.scopeType === "weekly" ? "Past-week cohort" : "Video deep dive";
                return (
                  <tr key={row.key}>
                    <td><span className="ma-badge" style={{ background: typeBg, color: typeColor }}>{r.label ?? r.scopeType}</span></td>
                    <td style={{ color: "var(--ma-text)" }}>{desc}</td>
                    <td><span style={{ color: statusColor(r.status), fontWeight: 600 }}>{r.status}</span></td>
                    <td>{ts(r.createdAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      {r.status === "complete" ? (
                        <Link href={`/moon-analysis/${r.id}/report`} target="_blank" className="ma-link">REPORT</Link>
                      ) : (
                        <Link href={`/moon-analysis/${r.id}`} className="ma-link">VIEW</Link>
                      )}
                    </td>
                  </tr>
                );
              }
              if (row.source === "script" && row.script) {
                const r = row.script;
                const verdictColor = r.verdict === "strong" ? "var(--ma-green)" : r.verdict === "weak" ? "var(--ma-red)" : r.verdict ? "var(--ma-amber)" : "var(--ma-muted)";
                return (
                  <tr key={row.key}>
                    <td><span className="ma-badge" style={{ background: "var(--ma-purple-dim)", color: "var(--ma-purple)" }}>SCRIPT</span></td>
                    <td style={{ color: "var(--ma-text)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.preview || "Script analysis"}</td>
                    <td>
                      <span style={{ color: statusColor(r.status), fontWeight: 600 }}>{r.status}</span>
                      {r.verdict && <span style={{ marginLeft: 6, color: verdictColor, fontWeight: 700, fontSize: 9, textTransform: "uppercase" as const }}>{r.verdict}</span>}
                    </td>
                    <td>{r.created_at ? ts(r.created_at) : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      {r.has_result && <button type="button" className="ma-link" style={{ background: "none", border: "none", cursor: "pointer", font: "inherit" }} onClick={() => viewResult(r.job_id)}>VIEW</button>}
                    </td>
                  </tr>
                );
              }
              return null;
            })}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .ma-root {
          --ma-bg: #080808;
          --ma-bg1: #0a0a0a;
          --ma-bg2: #0c0c0c;
          --ma-bg3: #111;
          --ma-border: #181818;
          --ma-border2: #222;
          --ma-text: #999;
          --ma-text-bright: #ccc;
          --ma-muted: #444;
          --ma-muted2: #666;
          --ma-cyan: #5b9;
          --ma-cyan-dim: #1a2a1e;
          --ma-amber: #c93;
          --ma-amber-dim: #2a1a0a;
          --ma-red: #a44;
          --ma-red-dim: #2a0f0f;
          --ma-green: #4a4;
          --ma-green-dim: #0a1a0a;
          --ma-purple: #86a;
          --ma-purple-dim: #1a0f2a;
          --ma-blue: #68a;
          --ma-blue-dim: #0f1a2a;
          --ma-mono: 'IBM Plex Mono', ui-monospace, monospace;

          min-height: calc(100vh - 32px);
          background: var(--ma-bg);
          color: var(--ma-text);
          font-family: var(--ma-mono);
          font-size: 11px;
          padding: 0 20px 40px;
          max-width: 960px;
          margin: 0 auto;
        }

        .ma-header {
          padding: 16px 0 12px;
          border-bottom: 1px solid var(--ma-border);
          margin-bottom: 12px;
        }
        .ma-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--ma-text-bright);
          letter-spacing: -0.5px;
        }
        .ma-meta {
          font-size: 10px;
          color: var(--ma-muted);
        }

        .ma-launchers {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1px;
          background: var(--ma-border);
        }

        .ma-panel {
          background: var(--ma-bg1);
          border: 1px solid var(--ma-border);
        }
        .ma-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 14px;
          border-bottom: 1px solid var(--ma-border);
          background: var(--ma-bg2);
        }
        .ma-section-label {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          color: var(--ma-muted2);
        }
        .ma-label {
          display: block;
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--ma-muted);
          margin-bottom: 3px;
        }
        .ma-input {
          width: 100%;
          background: var(--ma-bg);
          border: 1px solid var(--ma-border);
          color: var(--ma-text);
          font-family: var(--ma-mono);
          font-size: 11px;
          padding: 5px 8px;
          outline: none;
          border-radius: 2px;
        }
        .ma-input:focus { border-color: var(--ma-border2); }
        .ma-input::placeholder { color: var(--ma-muted); }
        .ma-textarea {
          width: 100%;
          background: var(--ma-bg);
          border: 1px solid var(--ma-border);
          color: var(--ma-text);
          font-family: var(--ma-mono);
          font-size: 11px;
          padding: 8px;
          outline: none;
          border-radius: 2px;
          min-height: 80px;
          resize: vertical;
          line-height: 1.6;
        }
        .ma-textarea:focus { border-color: var(--ma-border2); }
        .ma-textarea::placeholder { color: var(--ma-muted); }

        .ma-btn {
          font-family: var(--ma-mono);
          font-size: 10px;
          font-weight: 600;
          padding: 5px 11px;
          border: none;
          border-radius: 2px;
          cursor: pointer;
          white-space: nowrap;
          transition: opacity 0.15s;
        }
        .ma-btn:disabled { opacity: 0.5; cursor: default; }
        .ma-btn-cyan { background: var(--ma-cyan); color: #000; }
        .ma-btn-blue { background: var(--ma-blue); color: #000; }
        .ma-btn-amber { background: var(--ma-amber); color: #000; }
        .ma-btn-purple { background: var(--ma-purple); color: #000; }
        .ma-btn-muted { background: var(--ma-bg3); color: var(--ma-muted2); }

        .ma-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 2px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          white-space: nowrap;
        }

        .ma-pulse {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--ma-amber);
          animation: ma-pulse 1.4s ease-in-out infinite;
          flex-shrink: 0;
        }
        @keyframes ma-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        .ma-table {
          width: 100%;
          border-collapse: collapse;
        }
        .ma-table th {
          text-align: left;
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--ma-muted);
          padding: 6px 14px;
          border-bottom: 1px solid var(--ma-border);
          background: var(--ma-bg2);
        }
        .ma-table td {
          padding: 7px 14px;
          border-bottom: 1px solid var(--ma-border);
          font-size: 11px;
          color: var(--ma-muted2);
        }
        .ma-table tr:hover td {
          background: var(--ma-bg2);
        }

        .ma-link {
          font-family: var(--ma-mono);
          font-size: 10px;
          font-weight: 600;
          color: var(--ma-cyan);
          text-decoration: none;
          letter-spacing: 0.5px;
        }
        .ma-link:hover { color: var(--ma-text-bright); }

        @media (max-width: 720px) {
          .ma-root { padding: 0 10px 30px; }
          .ma-launchers { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
