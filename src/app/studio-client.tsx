"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { StudioGenerationSummary, StudioResearchSummary, StudioRunSummary } from "@/server/services/studio";

type FilterKind = "all" | "scripts" | "research" | "briefs" | "reports";
type FilterStatus = "all" | "complete" | "running" | "failed";
type StudioView = "list" | "research" | "generate";
type GenerateMode = "lab" | "agent";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload?.error === "string" && payload.error.trim()) return payload.error.trim();
    if (typeof payload?.detail === "string" && payload.detail.trim()) return payload.detail.trim();
  } catch {}
  try {
    const text = await response.text();
    if (text.trim()) return text.trim();
  } catch {}
  return `Request failed (${response.status})`;
}

function statusColor(status: string) {
  if (status === "complete") return "studio-status-complete";
  if (status === "running" || status === "queued") return "studio-status-running";
  if (status === "failed") return "studio-status-failed";
  return "studio-status-default";
}

export default function StudioClient({
  runs,
  researches = [],
  generations = [],
  initialView = "list",
  initialGenerateMode = "agent",
  generateOnly = false,
  headerLabel = "Moon News Studio",
  generateTitle = "Generate",
}: {
  runs: StudioRunSummary[];
  researches?: StudioResearchSummary[];
  generations?: StudioGenerationSummary[];
  initialView?: StudioView;
  initialGenerateMode?: GenerateMode;
  generateOnly?: boolean;
  headerLabel?: string;
  generateTitle?: string;
}) {
  const [view, setView] = useState<StudioView>(
    generateOnly ? "generate" : initialView === "research" ? "research" : "list"
  );
  const [kindFilter, setKindFilter] = useState<FilterKind>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");

  const filteredGenerations = generations.filter((item) => {
    if (kindFilter === "scripts" && item.category !== "script") return false;
    if (kindFilter === "research" && item.category !== "research") return false;
    if (kindFilter === "briefs" && item.category !== "brief") return false;
    if (kindFilter === "reports" && item.category !== "report") return false;
    if (statusFilter !== "all" && item.statusBucket !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q);
    }
    return true;
  });

  const completeCount = runs.filter((r) => r.status === "complete").length;
  const runningCount = runs.filter((r) => r.status === "running" || r.status === "queued").length;
  const failedCount = runs.filter((r) => r.status === "failed").length;
  const scriptCount = generations.filter((r) => r.category === "script").length;
  const researchGenerationCount = generations.filter((r) => r.category === "research").length;
  const briefCount = generations.filter((r) => r.category === "brief").length;
  const reportCount = generations.filter((r) => r.category === "report").length;
  const uniqueTitles = new Set(runs.map((r) => r.storyTitle));
  const filteredResearch = researches.filter((item) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return item.title.toLowerCase().includes(q) || item.slug.toLowerCase().includes(q);
  });
  const completeResearchCount = researches.filter((r) => r.hasPacket && r.hasWriterPack && r.hasMediaScan && r.hasMediaCollector).length;
  const packetCount = researches.filter((r) => r.hasPacket).length;
  const writerPackCount = researches.filter((r) => r.hasWriterPack).length;

  return (
    <>
      <style>{studioStyles}</style>
      <div className="studio-root">
        {/* Header */}
        <header className="studio-header">
          <div className="studio-header-left">
            <p className="studio-label">{headerLabel}</p>
            <h1 className="studio-title">
              {generateOnly
                ? generateTitle
                : view === "list"
                  ? "All Generations"
                  : "All Research"}
            </h1>
          </div>
          <div className="studio-header-stats">
            {view === "list" && !generateOnly ? (
              <>
                <span><b>{generations.length}</b> total</span>
                <span className="studio-pipe">|</span>
                <span><b>{scriptCount}</b> scripts</span>
                <span className="studio-pipe">|</span>
                <span><b>{researchGenerationCount}</b> research</span>
                <span className="studio-pipe">|</span>
                <span><b>{briefCount}</b> briefs</span>
                <span className="studio-pipe">|</span>
                <span><b>{reportCount}</b> reports</span>
              </>
            ) : view === "research" && !generateOnly ? (
              <>
                <span><b>{researches.length}</b> topics</span>
                <span className="studio-pipe">|</span>
                <span><b>{packetCount}</b> packets</span>
                <span className="studio-pipe">|</span>
                <span><b>{writerPackCount}</b> writer packs</span>
                <span className="studio-pipe">|</span>
                <span className="studio-stat-complete"><b>{completeResearchCount}</b> full sets</span>
              </>
            ) : (
              <>
                <span><b>{runs.length}</b> total</span>
                <span className="studio-pipe">|</span>
                <span><b>{uniqueTitles.size}</b> stories</span>
                <span className="studio-pipe">|</span>
                <span className="studio-stat-complete"><b>{completeCount}</b> complete</span>
                <span className="studio-pipe">|</span>
                <span className="studio-stat-running"><b>{runningCount}</b> in progress</span>
                {failedCount > 0 && (
                  <>
                    <span className="studio-pipe">|</span>
                    <span className="studio-stat-failed"><b>{failedCount}</b> failed</span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="studio-header-actions">
            {generateOnly ? (
              <Link className="studio-new-btn" href="/">
                Back to Studio
              </Link>
            ) : view === "list" ? (
              <Link className="studio-new-btn" href="/script-lab">
                + New Script
              </Link>
            ) : (
              <button
                className="studio-new-btn"
                onClick={() => setView("list")}
              >
                &#8592; Back to Generations
              </button>
            )}
          </div>
        </header>

        {!generateOnly && (
          <div className="studio-view-tabs">
            <button
              className={`studio-view-tab${view === "list" ? " active" : ""}`}
              onClick={() => setView("list")}
            >
              Generations
            </button>
            <button
              className={`studio-view-tab${view === "research" ? " active" : ""}`}
              onClick={() => setView("research")}
            >
              Research
            </button>
          </div>
        )}

        {generateOnly ? (
          <GenerateForm initialMode={initialGenerateMode} />
        ) : view === "research" ? (
          <>
            <div className="studio-filters">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search research..."
                className="studio-search studio-search-solo"
              />
            </div>
            <div className="studio-results-bar">
              {filteredResearch.length} research topic{filteredResearch.length !== 1 ? "s" : ""}
              {search && ` matching "${search}"`}
            </div>
            <div className="studio-list">
              {filteredResearch.map((item) => {
                const outputCount = [item.hasPacket, item.hasWriterPack, item.hasMediaScan, item.hasMediaCollector].filter(Boolean).length;
                return (
                  <div key={item.slug} className="studio-card studio-card-static">
                    <div className="studio-card-main">
                      <div className="studio-card-title">{item.title}</div>
                      <div className="studio-card-meta">
                        <span className={`studio-status-badge ${outputCount === 4 ? "studio-status-complete" : "studio-status-running"}`}>
                          {outputCount}/4 outputs
                        </span>
                        <span className="studio-kind-badge">slug: {item.slug}</span>
                        {item.deepResearchStatus ? (
                          <span className="studio-kind-badge">deep research: {item.deepResearchStatus}</span>
                        ) : null}
                      </div>
                      <div className="studio-research-links">
                        {item.hasPacket ? (
                          <Link className="studio-link-chip" href={`/research/packets/${item.slug}`}>Research Packet</Link>
                        ) : null}
                        {item.hasWriterPack ? (
                          <Link className="studio-link-chip" href={`/research/writer-packets/${item.slug}`}>Writer Pack</Link>
                        ) : null}
                        {item.hasMediaScan ? (
                          <Link className="studio-link-chip" href={`/research/media-mission-scan/${item.slug}`}>Media Scan</Link>
                        ) : null}
                        {item.hasMediaCollector ? (
                          <Link className="studio-link-chip" href={`/research/media-collector/${item.slug}`}>Media Collector</Link>
                        ) : null}
                      </div>
                    </div>
                    <div className="studio-card-right">
                      <div className="studio-card-date">{formatDate(item.updatedAt)}</div>
                      <div className="studio-card-time">{formatTime(item.updatedAt)}</div>
                      <div className="studio-card-ago">{timeAgo(item.updatedAt)}</div>
                    </div>
                  </div>
                );
              })}
              {filteredResearch.length === 0 && (
                <div className="studio-empty">
                  <div className="studio-empty-icon">&#9674;</div>
                  <div className="studio-empty-text">No research artifacts match your search</div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Filters */}
            <div className="studio-filters">
              <div className="studio-filter-group">
                {(["all", "scripts", "research", "briefs", "reports"] as FilterKind[]).map((k) => (
                  <button
                    key={k}
                    className={`studio-filter-btn${kindFilter === k ? " active" : ""}`}
                    onClick={() => setKindFilter(k)}
                  >
                    {k === "all"
                      ? `All (${generations.length})`
                      : k === "scripts"
                        ? `Scripts (${scriptCount})`
                        : k === "research"
                          ? `Research (${researchGenerationCount})`
                          : k === "briefs"
                            ? `Briefs (${briefCount})`
                            : `Reports (${reportCount})`}
                  </button>
                ))}
              </div>

              <div className="studio-filter-group">
                {(["all", "complete", "running", "failed"] as FilterStatus[]).map((s) => (
                  <button
                    key={s}
                    className={`studio-filter-btn${statusFilter === s ? " active" : ""}`}
                    onClick={() => setStatusFilter(s)}
                  >
                    {s === "all" ? "Any Status" : s}
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search generations..."
                className="studio-search"
              />
            </div>

            {/* Results count */}
            <div className="studio-results-bar">
              {filteredGenerations.length} generation{filteredGenerations.length !== 1 ? "s" : ""}
              {search && ` matching "${search}"`}
            </div>

            {/* Script list */}
            <div className="studio-list">
              {filteredGenerations.map((item) => (
                <Link key={item.id} href={item.href} className="studio-card">
                  <div className="studio-card-main">
                    <div className="studio-card-title">{item.title}</div>
                    <div className="studio-card-meta">
                      <span className={`studio-status-badge ${statusColor(item.statusBucket)}`}>
                        {item.status}
                      </span>
                      <span className="studio-kind-badge">
                        {item.kind.replace(/_/g, " ")}
                      </span>
                      <span className="studio-no-result">{item.subtitle}</span>
                    </div>
                    {item.links.length > 1 && (
                      <div className="studio-research-links">
                        {item.links.slice(0, 4).map((link) => (
                          <span key={link.href} className="studio-link-chip">{link.label}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="studio-card-right">
                    <div className="studio-card-date">{formatDate(item.updatedAt)}</div>
                    <div className="studio-card-time">{formatTime(item.updatedAt)}</div>
                    <div className="studio-card-ago">
                      {timeAgo(item.updatedAt)}
                    </div>
                  </div>
                </Link>
              ))}

              {filteredGenerations.length === 0 && (
                <div className="studio-empty">
                  <div className="studio-empty-icon">&#9674;</div>
                  <div className="studio-empty-text">No generations match your filters</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── Generate Form ───

function GenerateForm({ initialMode = "agent" }: { initialMode?: GenerateMode }) {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<GenerateMode>(initialMode);
  const [storyTitle, setStoryTitle] = useState("");
  const [researchText, setResearchText] = useState("");
  const [notes, setNotes] = useState("");
  const [targetRuntime, setTargetRuntime] = useState(12);
  const [objective, setObjective] = useState("");
  const [preferredAngle, setPreferredAngle] = useState("");
  const [researchDepth, setResearchDepth] = useState<"quick" | "standard" | "deep">("deep");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtimeNote, setRuntimeNote] = useState<string | null>(null);
  const [workflowTab, setWorkflowTab] = useState<"write" | "resolve" | "research">("write");

  useEffect(() => {
    const requestedMode = searchParams.get("mode");
    if (requestedMode === "agent" || requestedMode === "lab") {
      setMode(requestedMode);
    }
    const requestedTab = searchParams.get("tab");
    if (requestedTab === "resolve" || requestedTab === "research") {
      setWorkflowTab(requestedTab);
    }
  }, [searchParams]);

  const canSubmit = storyTitle.trim().length >= 3 && researchText.trim().length >= 200;

  const handleGenerate = useCallback(async () => {
    if (!canSubmit || generating) return;
    setGenerating(true);
    setError(null);
    setRuntimeNote(mode === "agent" ? "Creating agent run..." : "Creating Script Lab run...");
    const controller = new AbortController();
    const slowTimer = window.setTimeout(() => {
      setRuntimeNote(
        mode === "agent"
          ? "Still creating the run. If this keeps hanging, the API likely has not returned a run id yet."
          : "Still creating the Script Lab run. This request should normally return quickly."
      );
    }, 6000);
    const hardTimer = window.setTimeout(() => controller.abort(), 30000);

    try {
      if (mode === "agent") {
        const res = await fetch("/api/script-agent/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            storyTitle: storyTitle.trim(),
            researchText: researchText.trim(),
            notes: notes.trim(),
            targetRuntimeMinutes: targetRuntime,
            objective: objective.trim(),
            preferredAngle: preferredAngle.trim(),
            researchDepth,
          }),
        });

        if (!res.ok) {
          throw new Error(await readErrorMessage(res));
        }

        const data = await res.json() as { runId: string };
        window.clearTimeout(slowTimer);
        window.clearTimeout(hardTimer);
        setRuntimeNote(`Run created. Opening /script-agent/${data.runId} ...`);
        window.location.href = `/script-agent/${data.runId}`;
      } else {
        const res = await fetch("/api/script-lab/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            storyTitle: storyTitle.trim(),
            researchText: researchText.trim(),
            notes: notes.trim(),
            targetRuntimeMinutes: targetRuntime,
          }),
        });

        if (!res.ok) {
          throw new Error(await readErrorMessage(res));
        }

        const data = await res.json() as { permalink?: string; runId?: string };
        window.clearTimeout(slowTimer);
        window.clearTimeout(hardTimer);
        if (data.permalink) {
          setRuntimeNote(`Run created. Opening ${data.permalink} ...`);
          window.location.href = data.permalink;
        } else if (data.runId) {
          setRuntimeNote(`Run created. Opening /script-lab/${data.runId} ...`);
          window.location.href = `/script-lab/${data.runId}`;
        } else {
          setRuntimeNote("Run created, but no run id came back. Returning to Studio.");
          window.location.href = "/";
        }
      }
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "AbortError"
          ? mode === "agent"
            ? "The create-run request timed out before the server returned a run id. This usually means the API hung before enqueueing the script-agent run."
            : "The Script Lab create-run request timed out before the server returned a run id."
          : err instanceof Error
            ? err.message
            : "Generation failed";
      setError(message);
      setRuntimeNote("Generation did not start cleanly.");
      setGenerating(false);
    } finally {
      window.clearTimeout(slowTimer);
      window.clearTimeout(hardTimer);
    }
  }, [canSubmit, generating, mode, storyTitle, researchText, notes, targetRuntime, objective, preferredAngle, researchDepth]);

  return (
    <div className="sg-wrap">
      <div className="sg-form">
        <div className="sg-workflows">
          <button type="button" onClick={() => setWorkflowTab("write")} className={`sg-workflow-card${workflowTab === "write" ? " sg-workflow-card-active" : ""}`}>
            <div className="sg-workflow-eyebrow">Generate Here</div>
            <div className="sg-workflow-title">Write Script</div>
            <div className="sg-workflow-copy">Use Agent Pipeline or Script Lab below when you want a finished script draft.</div>
            <div className="sg-workflow-io">
              <div><strong>Input:</strong> research dossier, brief, or case notes</div>
              <div><strong>Output:</strong> finished script run that opens in the script editor</div>
            </div>
          </button>
          <button type="button" onClick={() => setWorkflowTab("resolve")} className={`sg-workflow-card${workflowTab === "resolve" ? " sg-workflow-card-active" : ""}`}>
            <div className="sg-workflow-eyebrow">Asset Resolver</div>
            <div className="sg-workflow-title">Resolve Assets</div>
            <div className="sg-workflow-copy">Paste a transcript, script, or outline to get clips, quotes, images, receipts, stock, and alternates for each segment.</div>
            <div className="sg-workflow-io">
              <div><strong>Input:</strong> transcript, finished script, or sectioned outline</div>
              <div><strong>Output:</strong> asset plan with resolved media per segment</div>
            </div>
          </button>
          <button type="button" onClick={() => setWorkflowTab("research")} className={`sg-workflow-card${workflowTab === "research" ? " sg-workflow-card-active" : ""}`}>
            <div className="sg-workflow-eyebrow">Research Here</div>
            <div className="sg-workflow-title">Deep Research</div>
            <div className="sg-workflow-copy">Enter any topic to research. Searches news, extracts sources, and synthesizes a full research brief with angles and titles.</div>
            <div className="sg-workflow-io">
              <div><strong>Input:</strong> topic, event, person, or trend</div>
              <div><strong>Output:</strong> research brief, timeline, angles, title options, script opener</div>
            </div>
          </button>
        </div>

        {workflowTab === "write" ? (
          <>
        {/* Mode toggle */}
        <div className="sg-mode-row">
          <div className="studio-filter-group">
            <button
              className={`studio-filter-btn${mode === "agent" ? " active" : ""}`}
              onClick={() => setMode("agent")}
            >
              Agent Pipeline
            </button>
            <button
              className={`studio-filter-btn${mode === "lab" ? " active" : ""}`}
              onClick={() => setMode("lab")}
            >
              Script Lab
            </button>
          </div>
          <span className="sg-mode-desc">
            {mode === "agent"
              ? "Full pipeline: discovers sources, extracts quotes, builds outline, writes sections, critiques, revises, polishes."
              : "Fast generation: scores against the Moon corpus, writes a Claude draft, critiques it, and rewrites it."}
          </span>
        </div>

        <div className="sg-mode-guide">
          {mode === "agent" ? (
            <>
              <div><strong>Best input:</strong> a real research dossier with facts, sources, quotes, notes, and angle constraints.</div>
              <div><strong>What you get:</strong> a full script run with research stages, evidence, outline, draft, revision, and final script.</div>
              <div><strong>Where it opens:</strong> <code>/script-agent/&lt;runId&gt;</code>.</div>
            </>
          ) : (
            <>
              <div><strong>Best input:</strong> a tighter dossier or rough research paste when you want speed over full pipeline breadth.</div>
              <div><strong>What you get:</strong> a faster documentary draft with critique and rewrite passes.</div>
              <div><strong>Where it opens:</strong> <code>/script-lab/&lt;runId&gt;</code>.</div>
            </>
          )}
        </div>

        {/* Title + Runtime row */}
        <div className="sg-row">
          <div className="sg-field sg-field-grow">
            <label className="sg-label">Story Title</label>
            <input
              className="sg-input"
              value={storyTitle}
              onChange={(e) => setStoryTitle(e.target.value)}
              placeholder="e.g. Meta Kills Instagram Encryption"
            />
          </div>
          <div className="sg-field sg-field-sm">
            <label className="sg-label">Runtime (min)</label>
            <input
              className="sg-input"
              type="number"
              min={3}
              max={25}
              value={targetRuntime}
              onChange={(e) => setTargetRuntime(Number(e.target.value) || 12)}
            />
          </div>
        </div>

        {/* Research dossier */}
        <div className="sg-field">
          <label className="sg-label">
            Research Dossier
            <span className="sg-label-hint">
              {researchText.length < 200
                ? ` (${200 - researchText.length} more chars needed)`
                : ` (${researchText.length} chars)`}
            </span>
          </label>
          <textarea
            className="sg-textarea"
            value={researchText}
            onChange={(e) => setResearchText(e.target.value)}
            placeholder="Paste your research here. Headlines, key facts, sources, evidence notes, quotes — the more context the better."
          />
        </div>

        {/* Notes */}
        <div className="sg-field">
          <label className="sg-label">Notes (optional)</label>
          <textarea
            className="sg-textarea sg-textarea-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Editorial direction, angle notes, weak spots, or constraints."
          />
        </div>

        {/* Agent-only fields */}
        {mode === "agent" && (
          <>
            <div className="sg-row">
              <div className="sg-field sg-field-grow">
                <label className="sg-label">Objective (optional)</label>
                <input
                  className="sg-input"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="e.g. Expose how this affects ordinary users"
                />
              </div>
              <div className="sg-field sg-field-grow">
                <label className="sg-label">Preferred Angle (optional)</label>
                <input
                  className="sg-input"
                  value={preferredAngle}
                  onChange={(e) => setPreferredAngle(e.target.value)}
                  placeholder="e.g. Privacy vs convenience tradeoff"
                />
              </div>
            </div>
            <div className="sg-field sg-field-inline">
              <label className="sg-label">Research Depth</label>
              <div className="studio-filter-group">
                {(["quick", "standard", "deep"] as const).map((d) => (
                  <button
                    key={d}
                    className={`studio-filter-btn${researchDepth === d ? " active" : ""}`}
                    onClick={() => setResearchDepth(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Submit */}
        <div className="sg-actions">
          <button
            className="sg-submit"
            onClick={handleGenerate}
            disabled={!canSubmit || generating}
          >
            {generating
              ? mode === "agent"
                ? "Launching pipeline..."
                : "Generating..."
              : mode === "agent"
                ? "Launch Agent Pipeline → Script Editor"
                : "Run Script Lab → Draft Editor"}
          </button>
          {runtimeNote && <div className="sg-runtime-note">{runtimeNote}</div>}
          {error && <div className="sg-error">{error}</div>}
        </div>

        {/* How it works */}
        <div className="sg-how">
          <div className="sg-label">How it works</div>
          {mode === "agent" ? (
            <ol className="sg-steps">
              <li>1. Discovers and ingests additional sources from the web</li>
              <li>2. Extracts evidence and quotes from sources + your research</li>
              <li>3. Synthesizes research, builds outline, plans sections</li>
              <li>4. Writes section-by-section with quote placement</li>
              <li>5. Critiques, revises, polishes, and expands to target length</li>
              <li>6. Opens in the script editor with AI assistant + feedback tools</li>
            </ol>
          ) : (
            <ol className="sg-steps">
              <li>1. Scores the story against the Moon transcript corpus</li>
              <li>2. Claude writes a first-pass documentary draft</li>
              <li>3. Claude critiques that draft and rewrites it</li>
              <li>4. Final pass strips AI phrasing and expands to target length</li>
              <li>5. Opens in the script editor for further editing</li>
            </ol>
          )}
        </div>
          </>
        ) : workflowTab === "resolve" ? (
          <AssetResolverForm />
        ) : (
          <DeepResearchForm />
        )}
      </div>
    </div>
  );
}

// ─── Asset Resolver Form ───

function AssetResolverForm() {
  const [scriptTitle, setScriptTitle] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const canSubmit = scriptText.trim().length >= 100;

  const handleResolve = useCallback(async () => {
    if (!canSubmit || resolving) return;
    setResolving(true);
    setError(null);
    setResult(null);
    setStatusNote("Sending script to asset resolver... This can take 2-5 minutes.");

    try {
      const res = await fetch("/api/script-lab/resolve-assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          script_text: scriptText.trim(),
          script_title: scriptTitle.trim() || undefined,
          context_notes: contextNotes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }

      const data = await res.json();
      setResult(data);
      setStatusNote(`Resolved ${data.segmentCount || 0} segments`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolution failed");
      setStatusNote(null);
    } finally {
      setResolving(false);
    }
  }, [canSubmit, resolving, scriptText, scriptTitle, contextNotes]);

  return (
    <>
      <div className="sg-mode-guide">
        <div><strong>Input:</strong> a transcript, finished script, or sectioned outline.</div>
        <div><strong>Output:</strong> asset plan with clips, quotes, images, receipts, stock footage, and alternates for each segment.</div>
        <div><strong>How:</strong> AI analyzes the script, identifies visual needs per segment, then searches for matching assets.</div>
      </div>

      <div className="sg-field">
        <label className="sg-label">Script Title (optional)</label>
        <input
          className="sg-input"
          value={scriptTitle}
          onChange={(e) => setScriptTitle(e.target.value)}
          placeholder="e.g. The Rise and Fall of FTX"
        />
      </div>

      <div className="sg-field">
        <label className="sg-label">
          Script / Transcript
          <span className="sg-label-hint">
            {scriptText.length < 100
              ? ` (${100 - scriptText.length} more chars needed)`
              : ` (${scriptText.length.toLocaleString()} chars)`}
          </span>
        </label>
        <textarea
          className="sg-textarea"
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          placeholder="Paste your script, transcript, or outline here. The resolver will identify visual needs for each segment and find matching clips, quotes, images, and stock footage."
        />
      </div>

      <div className="sg-field">
        <label className="sg-label">Context Notes (optional)</label>
        <textarea
          className="sg-textarea sg-textarea-sm"
          value={contextNotes}
          onChange={(e) => setContextNotes(e.target.value)}
          placeholder="Any additional context about the story, people involved, or visual preferences."
        />
      </div>

      <div className="sg-actions">
        <button
          className="sg-submit"
          onClick={handleResolve}
          disabled={!canSubmit || resolving}
        >
          {resolving ? "Resolving assets..." : "Resolve Assets"}
        </button>
        {statusNote && <div className="sg-runtime-note">{statusNote}</div>}
        {error && <div className="sg-error">{error}</div>}
      </div>

      {result && <AssetResolverResults data={result} />}
    </>
  );
}

// ─── Asset Resolver Results ───

function AssetResolverResults({ data }: { data: Record<string, unknown> }) {
  const [expandedSegment, setExpandedSegment] = useState<number | null>(null);
  const segments = (data.segments ?? []) as Array<Record<string, unknown>>;

  if (!segments.length) {
    return (
      <div className="sg-results">
        <div className="sg-results-header">No segments found</div>
      </div>
    );
  }

  return (
    <div className="sg-results">
      <div className="sg-results-header">
        {data.scriptTitle ? <span>{String(data.scriptTitle)} &mdash; </span> : null}
        {String(data.segmentCount ?? segments.length)} segments resolved
        {Number(data.resolvedTaskCount) > 0 && ` (${data.resolvedTaskCount} asset tasks)`}
      </div>

      {segments.map((seg) => {
        const idx = Number(seg.index);
        const isExpanded = expandedSegment === idx;
        const clips = (seg.resolvedClips ?? []) as Array<Record<string, unknown>>;
        const quotes = (seg.resolvedQuotes ?? []) as Array<Record<string, unknown>>;
        const images = (seg.resolvedImages ?? []) as Array<Record<string, unknown>>;
        const receipts = (seg.resolvedReceipts ?? []) as Array<Record<string, unknown>>;
        const stocks = (seg.resolvedStocks ?? []) as Array<Record<string, unknown>>;
        const reactions = (seg.reactionPosts ?? []) as Array<Record<string, unknown>>;
        const totalAssets = clips.length + quotes.length + images.length + receipts.length + stocks.length + reactions.length;

        return (
          <div key={idx} className="sg-segment">
            <button
              className="sg-segment-header"
              onClick={() => setExpandedSegment(isExpanded ? null : idx)}
              type="button"
            >
              <span className="sg-segment-time">{String(seg.timeLabel ?? "")}</span>
              <span className="sg-segment-beat">{String(seg.beatSummary ?? "")}</span>
              <span className="sg-segment-count">{totalAssets} assets</span>
              <span className="sg-segment-arrow">{isExpanded ? "\u25BE" : "\u25B8"}</span>
            </button>

            {isExpanded && (
              <div className="sg-segment-body">
                <div className="sg-segment-script">{String(seg.scriptText ?? "")}</div>

                {seg.editorNote ? (
                  <div className="sg-segment-note">{String(seg.editorNote)}</div>
                ) : null}

                {clips.length > 0 && (
                  <div className="sg-asset-group">
                    <div className="sg-asset-label">Clips ({clips.length})</div>
                    {clips.map((clip, i) => (
                      <a key={i} className="sg-asset-item" href={String(clip.sourceUrl ?? "#")} target="_blank" rel="noopener noreferrer">
                        <span className="sg-asset-title">{String(clip.title ?? "Untitled")}</span>
                        <span className="sg-asset-meta">
                          {String(clip.provider ?? "")}{clip.channelOrContributor ? ` \u00B7 ${clip.channelOrContributor}` : ""}
                        </span>
                      </a>
                    ))}
                  </div>
                )}

                {quotes.length > 0 && (
                  <div className="sg-asset-group">
                    <div className="sg-asset-label">Quotes ({quotes.length})</div>
                    {quotes.map((q, i) => (
                      <div key={i} className="sg-asset-item">
                        <span className="sg-asset-quote">&ldquo;{String(q.quoteText ?? "")}&rdquo;</span>
                        <span className="sg-asset-meta">
                          {q.speaker ? `\u2014 ${String(q.speaker)} \u00B7 ` : ""}{String(q.videoTitle ?? "")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {images.length > 0 && (
                  <div className="sg-asset-group">
                    <div className="sg-asset-label">Images ({images.length})</div>
                    {images.map((img, i) => (
                      <a key={i} className="sg-asset-item" href={String(img.imageUrl ?? "#")} target="_blank" rel="noopener noreferrer">
                        <span className="sg-asset-title">{String(img.title ?? "Image")}</span>
                        <span className="sg-asset-meta">{String(img.source ?? "")}</span>
                      </a>
                    ))}
                  </div>
                )}

                {receipts.length > 0 && (
                  <div className="sg-asset-group">
                    <div className="sg-asset-label">Receipts ({receipts.length})</div>
                    {receipts.map((r, i) => (
                      <a key={i} className="sg-asset-item" href={String(r.url ?? "#")} target="_blank" rel="noopener noreferrer">
                        <span className="sg-asset-title">{String(r.title ?? "")}</span>
                        <span className="sg-asset-meta">{String(r.snippet ?? "")}</span>
                      </a>
                    ))}
                  </div>
                )}

                {stocks.length > 0 && (
                  <div className="sg-asset-group">
                    <div className="sg-asset-label">Stock ({stocks.length})</div>
                    {stocks.map((s, i) => (
                      <a key={i} className="sg-asset-item" href={String(s.url ?? "#")} target="_blank" rel="noopener noreferrer">
                        <span className="sg-asset-title">{String(s.title ?? "")}</span>
                        <span className="sg-asset-meta">{String(s.provider ?? "")}</span>
                      </a>
                    ))}
                  </div>
                )}

                {reactions.length > 0 && (
                  <div className="sg-asset-group">
                    <div className="sg-asset-label">Reactions ({reactions.length})</div>
                    {reactions.map((r, i) => (
                      <a key={i} className="sg-asset-item" href={String(r.postUrl ?? "#")} target="_blank" rel="noopener noreferrer">
                        <span className="sg-asset-quote">&ldquo;{String(r.text ?? "")}&rdquo;</span>
                        <span className="sg-asset-meta">@{String(r.username ?? "")} \u00B7 {String(r.displayName ?? "")}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Deep Research Form ───

function DeepResearchForm() {
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [mode, setMode] = useState<"quick" | "full">("quick");
  const [researching, setResearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ step: string; progress: number; message: string } | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canSubmit = topic.trim().length >= 3;

  const handleResearch = useCallback(async () => {
    if (!canSubmit || researching) return;
    setResearching(true);
    setError(null);
    setResult(null);
    setProgress({ step: "pending", progress: 0, message: "Starting research..." });

    try {
      const res = await fetch("/api/script-lab/deep-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          context: context.trim() || undefined,
          mode,
        }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }

      const { progressId } = await res.json();

      const poll = async () => {
        try {
          const pres = await fetch(`/api/script-lab/deep-research/${progressId}`);
          if (!pres.ok) return;
          const data = await pres.json();
          setProgress({
            step: data.step,
            progress: data.progress,
            message: data.message,
          });

          if (data.step === "complete") {
            setResult(data.result);
            setResearching(false);
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          } else if (data.step === "failed") {
            setError(data.message || "Research failed");
            setResearching(false);
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch {
          // Retry on next interval
        }
      };

      pollRef.current = setInterval(poll, 3000);
      poll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start research");
      setResearching(false);
      setProgress(null);
    }
  }, [canSubmit, researching, topic, context, mode]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return (
    <>
      <div className="sg-mode-guide">
        <div><strong>Input:</strong> any topic you want to research &mdash; a story, event, person, trend, controversy.</div>
        <div><strong>Output:</strong> summary, timeline, key players, angles, title options, and a script opener.</div>
        <div><strong>How:</strong> searches news sources, extracts content, then AI synthesizes a structured research brief.</div>
      </div>

      <div className="sg-field">
        <label className="sg-label">Topic</label>
        <input
          className="sg-input"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. The TikTok Ban, Boeing Whistleblowers, or AI Copyright Lawsuits"
        />
      </div>

      <div className="sg-field">
        <label className="sg-label">Context / Background (optional)</label>
        <textarea
          className="sg-textarea sg-textarea-sm"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Any context, focus areas, or specific angles you want the research to explore."
        />
      </div>

      <div className="sg-field sg-field-inline">
        <label className="sg-label">Depth</label>
        <div className="studio-filter-group">
          <button
            type="button"
            className={`studio-filter-btn${mode === "quick" ? " active" : ""}`}
            onClick={() => setMode("quick")}
          >
            Quick
          </button>
          <button
            type="button"
            className={`studio-filter-btn${mode === "full" ? " active" : ""}`}
            onClick={() => setMode("full")}
          >
            Full
          </button>
        </div>
        <span className="sg-mode-desc" style={{ flex: 1 }}>
          {mode === "quick"
            ? "Searches 8 sources and synthesizes key findings. Fast (1-2 minutes)."
            : "Searches up to 20 sources for comprehensive coverage. Thorough (3-5 minutes)."}
        </span>
      </div>

      <div className="sg-actions">
        <button
          className="sg-submit"
          onClick={handleResearch}
          disabled={!canSubmit || researching}
        >
          {researching ? "Researching..." : "Run Deep Research"}
        </button>
        {error && <div className="sg-error">{error}</div>}
      </div>

      {progress && researching && (
        <div className="sg-progress">
          <div className="sg-progress-bar">
            <div className="sg-progress-fill" style={{ width: `${progress.progress}%` }} />
          </div>
          <div className="sg-progress-text">{progress.message}</div>
        </div>
      )}

      {result && <DeepResearchResults data={result} />}
    </>
  );
}

// ─── Deep Research Results ───

function DeepResearchResults({ data }: { data: Record<string, unknown> }) {
  const summary = String(data.summary ?? "");
  const keyPlayers = (data.key_players ?? []) as Array<Record<string, string>>;
  const timeline = (data.timeline ?? []) as Array<Record<string, string>>;
  const angles = (data.angle_suggestions ?? []) as string[];
  const titles = (data.title_options ?? []) as string[];
  const opener = String(data.script_opener ?? "");
  const score = Number(data.controversy_score ?? 0);
  const format = String(data.format_suggestion ?? "");

  return (
    <div className="sg-results">
      <div className="sg-results-header">Research Complete</div>

      {summary && (
        <div className="sg-result-section">
          <div className="sg-result-label">Summary</div>
          <div className="sg-result-text">{summary}</div>
        </div>
      )}

      {keyPlayers.length > 0 && (
        <div className="sg-result-section">
          <div className="sg-result-label">Key Players</div>
          <div className="sg-result-chips">
            {keyPlayers.map((p, i) => (
              <span key={i} className="sg-result-chip">
                <strong>{p.name}</strong> &mdash; {p.role}
              </span>
            ))}
          </div>
        </div>
      )}

      {timeline.length > 0 && (
        <div className="sg-result-section">
          <div className="sg-result-label">Timeline</div>
          <div className="sg-timeline">
            {timeline.map((t, i) => (
              <div key={i} className="sg-timeline-item">
                <span className="sg-timeline-date">{t.date}</span>
                <span className="sg-timeline-event">{t.event}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {angles.length > 0 && (
        <div className="sg-result-section">
          <div className="sg-result-label">Suggested Angles</div>
          <ol className="sg-result-list">
            {angles.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </div>
      )}

      {titles.length > 0 && (
        <div className="sg-result-section">
          <div className="sg-result-label">Title Options</div>
          <ol className="sg-result-list">
            {titles.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>
      )}

      {opener && (
        <div className="sg-result-section">
          <div className="sg-result-label">Script Opener</div>
          <div className="sg-result-text sg-result-opener">{opener}</div>
        </div>
      )}

      <div className="sg-result-section sg-result-meta-row">
        {score > 0 && (
          <span className="sg-result-meta">
            Controversy: <strong>{score}/100</strong>
          </span>
        )}
        {format && (
          <span className="sg-result-meta">
            Format: <strong>{format}</strong>
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───

const studioStyles = `
.studio-root {
  min-height: calc(100vh - 32px);
  background: #080808;
  color: #999;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 11px;
}

.studio-header {
  padding: 20px 24px 16px;
  border-bottom: 1px solid #151515;
  display: flex;
  align-items: flex-end;
  gap: 24px;
  flex-wrap: wrap;
}
.studio-header-left {
  flex: 1;
  min-width: 200px;
}
.studio-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: #444;
  margin-bottom: 6px;
}
.studio-title {
  font-size: 22px;
  font-weight: 700;
  color: #ccc;
  letter-spacing: -0.5px;
}
.studio-header-stats {
  display: flex;
  align-items: center;
  gap: 0;
  font-size: 10px;
  color: #555;
}
.studio-header-stats b {
  color: #999;
}
.studio-pipe {
  color: #222;
  padding: 0 8px;
}
.studio-stat-complete b { color: #5b9; }
.studio-stat-running b { color: #68a; }
.studio-stat-failed b { color: #a44; }

.studio-header-actions {
  flex-shrink: 0;
}
.studio-view-tabs {
  padding: 10px 24px 0;
  display: flex;
  gap: 6px;
}
.studio-view-tab {
  padding: 6px 12px;
  font-family: inherit;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #555;
  background: #0d0d0d;
  border: 1px solid #181818;
  border-radius: 3px;
  cursor: pointer;
}
.studio-view-tab:hover {
  color: #999;
  border-color: #222;
}
.studio-view-tab.active {
  color: #ccc;
  background: #141414;
  border-color: #2a2a2a;
}
.studio-new-btn {
  display: inline-block;
  padding: 8px 16px;
  background: #1a2a1e;
  color: #5b9;
  border-radius: 4px;
  text-decoration: none;
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  transition: all 0.15s;
  border: none;
  cursor: pointer;
}
.studio-new-btn:hover {
  background: #2a3a2e;
  color: #7dc;
}

/* Filters */
.studio-filters {
  padding: 10px 24px;
  border-bottom: 1px solid #111;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  background: #0a0a0a;
}
.studio-filter-group {
  display: flex;
  gap: 2px;
  border: 1px solid #181818;
  border-radius: 3px;
  overflow: hidden;
}
.studio-filter-btn {
  padding: 4px 12px;
  font-family: inherit;
  font-size: 10px;
  font-weight: 500;
  color: #555;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.12s;
  text-transform: capitalize;
}
.studio-filter-btn:hover {
  color: #999;
  background: #111;
}
.studio-filter-btn.active {
  color: #ccc;
  background: #181818;
}
.studio-search {
  margin-left: auto;
  padding: 4px 12px;
  width: 200px;
  background: #0c0c0c;
  border: 1px solid #181818;
  border-radius: 3px;
  color: #999;
  font-family: inherit;
  font-size: 10px;
  outline: none;
}
.studio-search:focus {
  border-color: #333;
}
.studio-search::placeholder {
  color: #333;
}
.studio-search-solo {
  margin-left: 0;
  width: 280px;
}

/* Results bar */
.studio-results-bar {
  padding: 6px 24px;
  font-size: 10px;
  color: #333;
  border-bottom: 1px solid #0e0e0e;
}

/* Script list */
.studio-list {
  padding: 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.studio-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: #0c0c0c;
  border: 1px solid #151515;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
  text-decoration: none;
  color: inherit;
}
.studio-card:hover {
  background: #111;
  border-color: #222;
  transform: translateY(-1px);
}
.studio-card-static {
  cursor: default;
}
.studio-card-static:hover {
  transform: none;
}

.studio-card-main {
  flex: 1;
  min-width: 0;
}
.studio-card-title {
  font-size: 13px;
  font-weight: 600;
  color: #ccc;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.studio-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.studio-status-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.studio-status-complete {
  background: #1a2a1e;
  color: #5b9;
}
.studio-status-running {
  background: #0f1a2a;
  color: #68a;
}
.studio-status-failed {
  background: #2a0f0f;
  color: #a44;
}
.studio-status-default {
  background: #181818;
  color: #555;
}

.studio-kind-badge {
  font-size: 9px;
  padding: 2px 7px;
  border-radius: 2px;
  background: #111;
  color: #555;
  border: 1px solid #1a1a1a;
}

.studio-has-result {
  font-size: 9px;
  color: #5b9;
}
.studio-no-result {
  font-size: 9px;
  color: #444;
  font-style: italic;
}

.studio-card-right {
  flex-shrink: 0;
  text-align: right;
  min-width: 100px;
}
.studio-card-date {
  font-size: 11px;
  color: #666;
}
.studio-card-time {
  font-size: 10px;
  color: #444;
}
.studio-card-ago {
  font-size: 9px;
  color: #333;
  margin-top: 2px;
}
.studio-research-links {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.studio-link-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border: 1px solid #1c1c1c;
  border-radius: 3px;
  color: #8fb4ff;
  background: #0d1016;
  font-size: 10px;
  text-decoration: none;
}
.studio-link-chip:hover {
  background: #111622;
  color: #b0cbff;
}

/* Empty state */
.studio-empty {
  text-align: center;
  padding: 60px 20px;
  color: #333;
}
.studio-empty-icon {
  font-size: 28px;
  margin-bottom: 10px;
}
.studio-empty-text {
  font-size: 12px;
}

/* Editorial badges */
.studio-edit-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 2px;
  text-transform: capitalize;
}
.studio-edit-draft { background: #181818; color: #555; }
.studio-edit-approved { background: #1a2a1e; color: #5b9; }
.studio-edit-needs { background: #2a0f0f; color: #a44; }
.studio-fb-badge {
  font-size: 9px;
  color: #c93;
  background: #2a1a0a;
  padding: 2px 6px;
  border-radius: 2px;
  font-weight: 600;
}

/* ─── Generate Form ─── */
.sg-wrap {
  padding: 24px;
  max-width: 800px;
}
.sg-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sg-workflows {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.sg-workflow-card {
  display: block;
  padding: 14px;
  border: 1px solid #1a1a1a;
  border-radius: 4px;
  background: #0c0c0c;
  text-decoration: none;
  color: inherit;
  transition: all 0.15s;
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  cursor: pointer;
  width: 100%;
}
.sg-workflow-card:hover {
  border-color: #2c2c2c;
  background: #101010;
}
.sg-workflow-card-active {
  border-color: #224433;
  background: #0d1611;
}
.sg-workflow-eyebrow {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1.4px;
  color: #4c6;
  margin-bottom: 8px;
}
.sg-workflow-title {
  font-size: 13px;
  font-weight: 600;
  color: #ddd;
  margin-bottom: 8px;
}
.sg-workflow-copy {
  font-size: 10px;
  line-height: 1.6;
  color: #666;
}
.sg-workflow-io {
  margin-top: 10px;
  display: grid;
  gap: 4px;
  font-size: 10px;
  line-height: 1.5;
  color: #7a7a7a;
}
.sg-workflow-io strong {
  color: #a0a0a0;
  font-weight: 600;
}
.sg-mode-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.sg-mode-desc {
  font-size: 10px;
  color: #555;
  flex: 1;
  min-width: 200px;
}
.sg-mode-guide {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid #151515;
  border-radius: 4px;
  background: #0a0a0a;
  font-size: 10px;
  line-height: 1.6;
  color: #767676;
}
.sg-mode-guide strong {
  color: #b0b0b0;
  font-weight: 600;
}
.sg-mode-guide code {
  color: #7dc;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 10px;
}
.sg-row {
  display: flex;
  gap: 12px;
}
.sg-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sg-field-grow { flex: 1; }
.sg-field-sm { width: 120px; flex-shrink: 0; }
.sg-field-inline { flex-direction: row; align-items: center; gap: 12px; }
.sg-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: #444;
}
.sg-label-hint {
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: #333;
  margin-left: 6px;
}
.sg-input {
  padding: 8px 12px;
  background: #0c0c0c;
  border: 1px solid #1a1a1a;
  border-radius: 3px;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
  outline: none;
}
.sg-input:focus { border-color: #333; }
.sg-input::placeholder { color: #333; }
.sg-textarea {
  padding: 12px 16px;
  background: #0c0c0c;
  border: 1px solid #1a1a1a;
  border-radius: 3px;
  color: #bbb;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.7;
  outline: none;
  resize: vertical;
  min-height: 280px;
}
.sg-textarea-sm { min-height: 80px; }
.sg-textarea:focus { border-color: #333; }
.sg-textarea::placeholder { color: #333; }
.sg-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 8px;
}
.sg-submit {
  padding: 10px 24px;
  background: #1a2a1e;
  color: #5b9;
  border: none;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.sg-submit:hover { background: #2a3a2e; color: #7dc; }
.sg-submit:disabled { opacity: 0.4; cursor: default; }
.sg-runtime-note {
  font-size: 10px;
  color: #777;
  max-width: 420px;
  line-height: 1.5;
}
.sg-error {
  font-size: 11px;
  color: #a44;
  padding: 6px 10px;
  background: #2a0f0f;
  border-radius: 3px;
}
.sg-how {
  margin-top: 8px;
  padding: 16px;
  background: #0a0a0a;
  border: 1px solid #151515;
  border-radius: 4px;
}
.sg-steps {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sg-steps li {
  font-size: 11px;
  color: #666;
  line-height: 1.5;
}
/* Progress */
.sg-progress {
  margin-top: 12px;
}
.sg-progress-bar {
  height: 4px;
  background: #151515;
  border-radius: 2px;
  overflow: hidden;
}
.sg-progress-fill {
  height: 100%;
  background: #4c6;
  transition: width 0.5s ease;
}
.sg-progress-text {
  font-size: 10px;
  color: #666;
  margin-top: 6px;
}

/* Results */
.sg-results {
  margin-top: 20px;
  padding: 16px;
  background: #0a0a0a;
  border: 1px solid #1a1a1a;
  border-radius: 4px;
}
.sg-results-header {
  font-size: 12px;
  font-weight: 600;
  color: #5b9;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #151515;
}
.sg-result-section {
  margin-bottom: 16px;
}
.sg-result-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: #555;
  margin-bottom: 8px;
}
.sg-result-text {
  font-size: 12px;
  line-height: 1.7;
  color: #bbb;
  white-space: pre-wrap;
}
.sg-result-opener {
  padding: 12px;
  background: #0d0d0d;
  border: 1px solid #181818;
  border-radius: 3px;
  font-style: italic;
}
.sg-result-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sg-result-chip {
  display: inline-block;
  padding: 4px 10px;
  background: #111;
  border: 1px solid #1a1a1a;
  border-radius: 3px;
  font-size: 11px;
  color: #999;
}
.sg-result-chip strong {
  color: #ccc;
}
.sg-result-list {
  list-style: decimal;
  padding-left: 20px;
  margin: 0;
}
.sg-result-list li {
  font-size: 11px;
  color: #999;
  line-height: 1.6;
  margin-bottom: 4px;
}
.sg-result-meta-row {
  display: flex;
  gap: 20px;
}
.sg-result-meta {
  font-size: 10px;
  color: #666;
}
.sg-result-meta strong {
  color: #999;
}

/* Timeline */
.sg-timeline {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sg-timeline-item {
  display: flex;
  gap: 12px;
  font-size: 11px;
  line-height: 1.5;
}
.sg-timeline-date {
  flex-shrink: 0;
  width: 100px;
  color: #7dc;
  font-weight: 500;
}
.sg-timeline-event {
  color: #999;
}

/* Segments (asset resolver) */
.sg-segment {
  border: 1px solid #181818;
  border-radius: 3px;
  margin-bottom: 4px;
  overflow: hidden;
}
.sg-segment-header {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 14px;
  background: #0d0d0d;
  border: none;
  color: inherit;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}
.sg-segment-header:hover {
  background: #111;
}
.sg-segment-time {
  flex-shrink: 0;
  color: #7dc;
  font-weight: 600;
  width: 50px;
}
.sg-segment-beat {
  flex: 1;
  color: #999;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sg-segment-count {
  flex-shrink: 0;
  font-size: 9px;
  color: #555;
  background: #151515;
  padding: 2px 6px;
  border-radius: 2px;
}
.sg-segment-arrow {
  flex-shrink: 0;
  color: #444;
  font-size: 10px;
}
.sg-segment-body {
  padding: 14px;
  border-top: 1px solid #151515;
}
.sg-segment-script {
  font-size: 11px;
  line-height: 1.7;
  color: #888;
  margin-bottom: 12px;
  white-space: pre-wrap;
}
.sg-segment-note {
  font-size: 10px;
  color: #c93;
  background: #1a1208;
  padding: 6px 10px;
  border-radius: 3px;
  margin-bottom: 12px;
}
.sg-asset-group {
  margin-bottom: 12px;
}
.sg-asset-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #444;
  margin-bottom: 6px;
}
.sg-asset-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  margin-bottom: 2px;
  background: #0c0c0c;
  border: 1px solid #151515;
  border-radius: 2px;
  text-decoration: none;
  color: inherit;
  transition: background 0.1s;
}
a.sg-asset-item:hover {
  background: #111;
}
.sg-asset-title {
  font-size: 11px;
  color: #999;
}
.sg-asset-meta {
  font-size: 9px;
  color: #555;
}
.sg-asset-quote {
  font-size: 11px;
  color: #c9c9a0;
  font-style: italic;
}

@media (max-width: 900px) {
  .sg-workflows {
    grid-template-columns: 1fr;
  }
}
`;
