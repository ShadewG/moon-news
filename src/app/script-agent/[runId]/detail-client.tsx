"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { buildLibraryQuotesHref } from "@/lib/library-quotes";
import type { ScriptAgentRun } from "@/lib/script-agent";
import { ScriptAgentStageViewer } from "./stage-viewer";
import { AiAssistantPanel, aiAssistantStyles } from "./ai-assistant-panel";
import { QuoteFinderPanel, quoteFinderStyles } from "./quote-finder-panel";

type Tab = "script" | "research" | "pipeline";

interface EditData {
  id: string;
  editedTitle: string | null;
  editedScript: string | null;
  editedDeck: string | null;
  editStatus: string;
  version: number;
  createdAt: string;
}

interface FeedbackItem {
  id: string;
  anchor: string | null;
  body: string;
  resolved: boolean;
  createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "complete" || status === "approved" || status === "final"
      ? "sa-badge-green"
      : status === "failed" || status === "needs_revision"
        ? "sa-badge-red"
        : status === "running" || status === "in_review"
          ? "sa-badge-blue"
          : "sa-badge-muted";
  return <span className={`sa-badge ${cls}`}>{status.replace("_", " ")}</span>;
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatTimestamp(ms: number | null | undefined) {
  if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function buildTimestampUrl(
  sourceUrl: string | null | undefined,
  startMs: number | null | undefined
) {
  if (!sourceUrl) return null;
  if (typeof startMs !== "number" || Number.isNaN(startMs) || startMs < 0)
    return sourceUrl;
  try {
    const url = new URL(sourceUrl);
    url.searchParams.set("t", String(Math.floor(startMs / 1000)));
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function parseSourceNoteEntries(noteContent: string) {
  return noteContent
    .split(/\s*;\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);
      const url = [...parts].reverse().find((part) => /^https?:\/\//i.test(part)) ?? null;
      const label = (url ? parts.filter((part) => part !== url) : parts).join(" | ").trim() || entry;
      return {
        label,
        url,
      };
    });
}

function renderScriptTextWithSourceNotes(text: string) {
  const sourceNoteRegex = /\[Source:\s*([^\]]+)\]/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sourceNoteRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const entries = parseSourceNoteEntries(match[1] ?? "");
    nodes.push(
      <span
        key={`source-note-${match.index}`}
        className="sa-source-note"
      >
        [Source:{" "}
        {entries.map((entry, index) => (
          <span key={`${entry.label}-${entry.url ?? index}`}>
            {index > 0 ? "; " : null}
            {entry.url ? (
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer"
                className="sa-source-note-link"
                title={entry.url}
              >
                {entry.label}
              </a>
            ) : (
              <span>{entry.label}</span>
            )}
          </span>
        ))}
        ]
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

// ─── API helpers ───

async function apiGet(runId: string, kind: string) {
  const res = await fetch(`/api/scripts/${runId}?kind=${kind}`);
  return res.json();
}

async function apiPost(runId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/scripts/${runId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── Main Component ───

export default function ScriptAgentDetail({ run }: { run: ScriptAgentRun }) {
  const [activeTab, setActiveTab] = useState<Tab>("script");
  const [edit, setEdit] = useState<EditData | null>(null);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [editHistory, setEditHistory] = useState<EditData[]>([]);
  const [loaded, setLoaded] = useState(false);

  const runKind = "agent";

  // Load editorial data
  useEffect(() => {
    apiGet(run.id, runKind).then((data) => {
      setEdit(data.edit);
      setFeedback(data.feedback ?? []);
      setEditHistory(data.editHistory ?? []);
      setLoaded(true);
    });
  }, [run.id]);

  // Extract the final script
  const finalVariant =
    run.result?.variants?.final ?? run.result?.variants?.hybrid ?? null;
  const claudeVariant = run.result?.variants?.claude ?? null;
  const bestDraft = finalVariant?.draft ?? claudeVariant?.draft ?? null;
  const moonAnalysis = run.result?.moonAnalysis ?? null;

  // Current title/script/deck — prefer edit over original
  const currentTitle = edit?.editedTitle ?? bestDraft?.title ?? run.storyTitle;
  const currentScript = edit?.editedScript ?? bestDraft?.script ?? "";
  const currentDeck = edit?.editedDeck ?? bestDraft?.deck ?? "";
  const editStatus = edit?.editStatus ?? "draft";

  // Quotes
  const selectedQuoteStage = run.stages.find(
    (s) => s.stageKey === "select_quotes"
  );
  const selectedQuotes =
    selectedQuoteStage?.outputJson &&
    typeof selectedQuoteStage.outputJson === "object" &&
    !Array.isArray(selectedQuoteStage.outputJson) &&
    Array.isArray(
      (selectedQuoteStage.outputJson as { selectedQuotes?: unknown })
        .selectedQuotes
    )
      ? (
          (
            selectedQuoteStage.outputJson as {
              selectedQuotes: Array<Record<string, unknown>>;
            }
          ).selectedQuotes ?? []
        )
      : [];

  const quoteBankItems =
    selectedQuotes.length > 0
      ? selectedQuotes.slice(0, 12).map((q) => ({
          id: String(q.quoteId ?? q.quoteText ?? "q"),
          quoteText: String(q.quoteText ?? ""),
          sourceLabel: String(q.sourceTitle ?? q.sourceLabel ?? ""),
          speaker: typeof q.speaker === "string" ? q.speaker : null,
          sourceUrl: typeof q.sourceUrl === "string" ? q.sourceUrl : null,
          startMs: typeof q.startMs === "number" ? q.startMs : null,
        }))
      : run.quotes.slice(0, 12).map((q) => ({
          id: q.id,
          quoteText: q.quoteText,
          sourceLabel: q.sourceLabel,
          speaker: q.speaker,
          sourceUrl: q.sourceUrl,
          startMs: q.startMs,
        }));

  const completedStages = run.stages.filter(
    (s) => s.status === "complete"
  ).length;
  const totalStages = run.stages.length;
  const openFeedback = feedback.filter((f) => !f.resolved).length;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "script", label: "Script" },
    {
      id: "research",
      label: "Research",
      count: run.sources.length,
    },
    { id: "pipeline", label: "Pipeline", count: completedStages },
  ];

  // ─── Handlers ───

  const handleSaveEdit = useCallback(
    async (title: string, script: string, deck: string) => {
      const data = await apiPost(run.id, {
        action: "save_edit",
        kind: runKind,
        editedTitle: title,
        editedScript: script,
        editedDeck: deck,
      });
      setEdit(data.edit);
      // Refresh history
      const refreshed = await apiGet(run.id, runKind);
      setEditHistory(refreshed.editHistory ?? []);
    },
    [run.id]
  );

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      if (!edit) {
        // Create initial edit first
        await apiPost(run.id, {
          action: "save_edit",
          kind: runKind,
          editedTitle: currentTitle,
          editedScript: currentScript,
          editedDeck: currentDeck,
          editStatus: newStatus,
        });
      } else {
        await apiPost(run.id, {
          action: "update_status",
          kind: runKind,
          editStatus: newStatus,
        });
      }
      const refreshed = await apiGet(run.id, runKind);
      setEdit(refreshed.edit);
      setEditHistory(refreshed.editHistory ?? []);
    },
    [run.id, edit, currentTitle, currentScript, currentDeck]
  );

  const handleAddFeedback = useCallback(
    async (body: string, anchor?: string) => {
      const data = await apiPost(run.id, {
        action: "add_feedback",
        kind: runKind,
        body,
        anchor,
      });
      setFeedback((prev) => [data.feedback, ...prev]);
    },
    [run.id]
  );

  const handleResolveFeedback = useCallback(
    async (feedbackId: string) => {
      await apiPost(run.id, {
        action: "resolve_feedback",
        kind: runKind,
        feedbackId,
      });
      setFeedback((prev) =>
        prev.map((f) => (f.id === feedbackId ? { ...f, resolved: true } : f))
      );
    },
    [run.id]
  );

  const handleDeleteFeedback = useCallback(
    async (feedbackId: string) => {
      await apiPost(run.id, {
        action: "delete_feedback",
        kind: runKind,
        feedbackId,
      });
      setFeedback((prev) => prev.filter((f) => f.id !== feedbackId));
    },
    [run.id]
  );

  // ─── Text Selection Tracking ───
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [showQuoteFinder, setShowQuoteFinder] = useState(false);

  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      setSelectedText(text.length > 2 ? text : null);
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  // ─── Keyboard Shortcuts ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+Shift+F — Toggle Quote Finder
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "F") {
        e.preventDefault();
        setShowQuoteFinder((prev) => !prev);
      }
      // Escape — close panels
      if (e.key === "Escape") {
        setShowQuoteFinder(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Research context string for AI assistant
  const researchContext = run.sources
    .slice(0, 6)
    .map((s) => `${s.title}: ${s.snippet ?? ""}`)
    .join("\n");

  return (
    <>
      <style>{detailStyles}{aiAssistantStyles}{quoteFinderStyles}</style>
      <div className="sa-root">
        <QuoteFinderPanel
          runId={run.id}
          selectedText={selectedText}
          onInsertQuote={(text) => {
            // Insert at the end of the script or wherever the cursor is
            const currentEdit = document.querySelector<HTMLTextAreaElement>(".sa-edit-textarea");
            if (currentEdit) {
              const pos = currentEdit.selectionStart ?? currentEdit.value.length;
              const before = currentEdit.value.slice(0, pos);
              const after = currentEdit.value.slice(pos);
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, "value"
              )?.set;
              nativeInputValueSetter?.call(currentEdit, before + "\n\n" + text + "\n\n" + after);
              currentEdit.dispatchEvent(new Event("input", { bubbles: true }));
            }
            setShowQuoteFinder(false);
          }}
          visible={showQuoteFinder}
          onClose={() => setShowQuoteFinder(false)}
        />
        {/* Header */}
        <header className="sa-header">
          <Link href="/" className="sa-back">
            ← Studio
          </Link>
          <div className="sa-header-main">
            <div className="sa-header-left">
              <h1 className="sa-title">{currentTitle}</h1>
              <div className="sa-header-meta">
                <StatusBadge status={run.status} />
                {edit && <StatusBadge status={editStatus} />}
                <span className="sa-meta-text">
                  {new Date(run.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">
                  {run.sources.length} sources
                </span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">
                  {run.quotes.length} quotes
                </span>
                <span className="sa-meta-sep">|</span>
                <span className="sa-meta-text">
                  {completedStages}/{totalStages} stages
                </span>
                {currentScript && (
                  <>
                    <span className="sa-meta-sep">|</span>
                    <span className="sa-meta-text sa-meta-accent">
                      {countWords(currentScript)} words
                    </span>
                  </>
                )}
                {openFeedback > 0 && (
                  <>
                    <span className="sa-meta-sep">|</span>
                    <span className="sa-meta-text sa-meta-warn">
                      {openFeedback} open notes
                    </span>
                  </>
                )}
                {edit && (
                  <>
                    <span className="sa-meta-sep">|</span>
                    <span className="sa-meta-text">v{edit.version}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Tabs */}
        <nav className="sa-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`sa-tab${activeTab === tab.id ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="sa-tab-count">{tab.count}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="sa-content">
          {activeTab === "script" && (
            <ScriptTab
              draft={bestDraft}
              currentTitle={currentTitle}
              currentScript={currentScript}
              currentDeck={currentDeck}
              editStatus={editStatus}
              moonAnalysis={moonAnalysis}
              run={run}
              feedback={feedback}
              editHistory={editHistory}
              onSave={handleSaveEdit}
              onStatusChange={handleStatusChange}
              onAddFeedback={handleAddFeedback}
              onResolveFeedback={handleResolveFeedback}
              onDeleteFeedback={handleDeleteFeedback}
              selectedText={selectedText}
              researchContext={researchContext}
              onToggleQuoteFinder={() => setShowQuoteFinder(true)}
            />
          )}
          {activeTab === "research" && (
            <ResearchTab
              sources={run.sources}
              claims={run.claims}
              quotes={quoteBankItems}
            />
          )}
          {activeTab === "pipeline" && (
            <div className="sa-pipeline-wrap">
              <ScriptAgentStageViewer run={run} />
            </div>
          )}
        </main>
      </div>
    </>
  );
}

// ─── Script Tab ───

function ScriptTab({
  draft,
  currentTitle,
  currentScript,
  currentDeck,
  editStatus,
  moonAnalysis,
  run,
  feedback,
  editHistory,
  onSave,
  onStatusChange,
  onAddFeedback,
  onResolveFeedback,
  onDeleteFeedback,
  selectedText,
  researchContext,
  onToggleQuoteFinder,
}: {
  draft: {
    title: string;
    deck: string;
    script: string;
    beats: string[];
    angle: string;
    warnings: string[];
  } | null;
  currentTitle: string;
  currentScript: string;
  currentDeck: string;
  editStatus: string;
  moonAnalysis: {
    moonFitScore: number;
    moonFitBand: string;
    clusterLabel?: string | null;
    coverageMode?: string | null;
    analogTitles: string[];
  } | null;
  run: ScriptAgentRun;
  feedback: FeedbackItem[];
  editHistory: EditData[];
  onSave: (title: string, script: string, deck: string) => Promise<void>;
  onStatusChange: (status: string) => Promise<void>;
  onAddFeedback: (body: string, anchor?: string) => Promise<void>;
  onResolveFeedback: (id: string) => Promise<void>;
  onDeleteFeedback: (id: string) => Promise<void>;
  selectedText: string | null;
  researchContext: string;
  onToggleQuoteFinder: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(currentTitle);
  const [editScript, setEditScript] = useState(currentScript);
  const [editDeck, setEditDeck] = useState(currentDeck);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const scriptRef = useRef<HTMLTextAreaElement>(null);

  // Sync when current values change
  useEffect(() => {
    if (!editing) {
      setEditTitle(currentTitle);
      setEditScript(currentScript);
      setEditDeck(currentDeck);
    }
  }, [currentTitle, currentScript, currentDeck, editing]);

  // Cmd+S to save when editing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && editing && !saving) {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape" && editing) {
        setEditing(false);
        setEditTitle(currentTitle);
        setEditScript(currentScript);
        setEditDeck(currentDeck);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, saving, editTitle, editScript, editDeck]);

  if (!draft && !currentScript) {
    return (
      <div className="sa-empty">
        <div className="sa-empty-icon">&#9674;</div>
        <div className="sa-empty-text">
          {run.status === "running" || run.status === "queued"
            ? "Script is still being generated..."
            : run.status === "failed"
              ? "This run failed before producing a script."
              : "No script output yet."}
        </div>
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    await onSave(editTitle, editScript, editDeck);
    setSaving(false);
    setEditing(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const content = `# ${currentTitle}\n\n${currentDeck}\n\n---\n\n${currentScript}`;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddFeedback = async () => {
    if (!feedbackText.trim()) return;
    await onAddFeedback(feedbackText.trim());
    setFeedbackText("");
  };

  const statuses = [
    "draft",
    "in_review",
    "needs_revision",
    "approved",
    "final",
  ];

  return (
    <div className="sa-script-layout">
      {/* Main script area */}
      <div className="sa-script-main">
        {/* Toolbar */}
        <div className="sa-toolbar">
          <div className="sa-toolbar-left">
            {!editing ? (
              <button className="sa-tool-btn" onClick={() => setEditing(true)}>
                &#9998; Edit
              </button>
            ) : (
              <>
                <button
                  className="sa-tool-btn sa-tool-save"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  className="sa-tool-btn"
                  onClick={() => {
                    setEditing(false);
                    setEditTitle(currentTitle);
                    setEditScript(currentScript);
                    setEditDeck(currentDeck);
                  }}
                >
                  Cancel
                </button>
              </>
            )}
            <button className="sa-tool-btn" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy"}
            </button>
            <button className="sa-tool-btn" onClick={handleExport}>
              Export .md
            </button>
            <button className="sa-tool-btn" onClick={onToggleQuoteFinder}>
              &#128269; Quotes
            </button>
          </div>
          <div className="sa-toolbar-right">
            <span className="sa-toolbar-label">Status:</span>
            <select
              className="sa-status-select"
              value={editStatus}
              onChange={(e) => onStatusChange(e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Script content */}
        {editing ? (
          <div className="sa-edit-area">
            <div className="sa-edit-field">
              <label className="sa-edit-label">Title</label>
              <input
                className="sa-edit-input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div className="sa-edit-field">
              <label className="sa-edit-label">Deck</label>
              <input
                className="sa-edit-input"
                value={editDeck}
                onChange={(e) => setEditDeck(e.target.value)}
              />
            </div>
            <div className="sa-edit-field sa-edit-field-grow">
              <label className="sa-edit-label">
                Script ({countWords(editScript)} words)
              </label>
              <textarea
                ref={scriptRef}
                className="sa-edit-textarea"
                value={editScript}
                onChange={(e) => setEditScript(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="sa-script-header">
              <h2 className="sa-script-title">{currentTitle}</h2>
              <p className="sa-script-deck">{currentDeck}</p>
              <div className="sa-script-stats">
                <span>{countWords(currentScript)} words</span>
                <span className="sa-meta-sep">|</span>
                <span>
                  ~{Math.ceil(countWords(currentScript) / 150)} min read
                </span>
              </div>
            </div>
            <WordCountTarget script={currentScript} targetMinutes={run.request?.targetRuntimeMinutes} />
            <ScriptBodyWithSections script={currentScript} />
          </>
        )}
      </div>

      {/* Sidebar */}
      <aside className="sa-script-sidebar">
        {/* Feedback / Notes */}
        <div className="sa-sidebar-card">
          <div className="sa-sidebar-label">
            Notes & Feedback ({feedback.filter((f) => !f.resolved).length} open)
          </div>
          <div className="sa-feedback-input-row">
            <input
              className="sa-feedback-input"
              placeholder="Add a note..."
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAddFeedback();
                }
              }}
            />
            <button
              className="sa-feedback-add"
              onClick={handleAddFeedback}
              disabled={!feedbackText.trim()}
            >
              +
            </button>
          </div>
          <div className="sa-feedback-list">
            {feedback.map((f) => (
              <div
                key={f.id}
                className={`sa-feedback-item${f.resolved ? " resolved" : ""}`}
              >
                <p className="sa-feedback-body">{f.body}</p>
                <div className="sa-feedback-meta">
                  <span>{timeAgo(f.createdAt)}</span>
                  {f.anchor && (
                    <span className="sa-feedback-anchor">{f.anchor}</span>
                  )}
                  <div className="sa-feedback-actions">
                    {!f.resolved && (
                      <button
                        className="sa-fb-btn"
                        onClick={() => onResolveFeedback(f.id)}
                      >
                        &#10003;
                      </button>
                    )}
                    <button
                      className="sa-fb-btn sa-fb-del"
                      onClick={() => onDeleteFeedback(f.id)}
                    >
                      &#10005;
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {feedback.length === 0 && (
              <div className="sa-empty-small">No notes yet.</div>
            )}
          </div>
        </div>

        {/* AI Assistant */}
        <AiAssistantPanel
          runId={run.id}
          selectedText={selectedText}
          fullScript={editing ? editScript : currentScript}
          researchContext={researchContext}
          onApplyText={(text) => {
            if (editing && selectedText) {
              // Replace selected text in the edit textarea
              const idx = editScript.indexOf(selectedText);
              if (idx >= 0) {
                setEditScript(
                  editScript.slice(0, idx) + text + editScript.slice(idx + selectedText.length)
                );
              } else {
                setEditScript(editScript + "\n\n" + text);
              }
            } else {
              // Start editing and append
              if (!editing) {
                setEditing(true);
                setEditScript(currentScript + "\n\n" + text);
              } else {
                setEditScript(editScript + "\n\n" + text);
              }
            }
          }}
        />

        {/* Moon Analysis */}
        {moonAnalysis && (
          <div className="sa-sidebar-card">
            <div className="sa-sidebar-label">Moon Analysis</div>
            <div className="sa-moon-score">
              <span className="sa-moon-num">{moonAnalysis.moonFitScore}</span>
              <span className="sa-moon-band">{moonAnalysis.moonFitBand}</span>
            </div>
            {moonAnalysis.clusterLabel && (
              <div className="sa-moon-tag">{moonAnalysis.clusterLabel}</div>
            )}
            {moonAnalysis.coverageMode && (
              <div className="sa-moon-tag">{moonAnalysis.coverageMode}</div>
            )}
            {moonAnalysis.analogTitles.length > 0 && (
              <div className="sa-analogs">
                <div className="sa-sidebar-sublabel">Nearest analogs</div>
                {moonAnalysis.analogTitles.slice(0, 4).map((t) => (
                  <div key={t} className="sa-analog-item">
                    {t}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Angle & Beats */}
        {draft && (
          <>
            <div className="sa-sidebar-card">
              <div className="sa-sidebar-label">Angle</div>
              <p className="sa-sidebar-text">{draft.angle}</p>
            </div>
            <div className="sa-sidebar-card">
              <div className="sa-sidebar-label">
                Beats ({draft.beats.length})
              </div>
              <ol className="sa-beats-list">
                {draft.beats.map((beat, i) => (
                  <li key={i} className="sa-beat-item">
                    <span className="sa-beat-num">{i + 1}</span>
                    {beat}
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}

        {/* Warnings */}
        {draft && draft.warnings.length > 0 && (
          <div className="sa-sidebar-card sa-warnings-card">
            <div className="sa-sidebar-label">Warnings</div>
            {draft.warnings.map((w) => (
              <div key={w} className="sa-warning-item">
                {w}
              </div>
            ))}
          </div>
        )}

        {/* Version History */}
        <div className="sa-sidebar-card">
          <div
            className="sa-sidebar-label sa-clickable"
            onClick={() => setShowHistory(!showHistory)}
          >
            Version History ({editHistory.length}){" "}
            {showHistory ? "▾" : "▸"}
          </div>
          {showHistory && (
            <div className="sa-history-list">
              {editHistory.map((h) => (
                <div key={h.id} className="sa-history-item">
                  <span className="sa-history-ver">v{h.version}</span>
                  <span className="sa-history-status">{h.editStatus.replace("_", " ")}</span>
                  <span className="sa-history-date">
                    {timeAgo(h.createdAt)}
                  </span>
                </div>
              ))}
              {editHistory.length === 0 && (
                <div className="sa-empty-small">No edits yet.</div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── Word Count Target ───

function WordCountTarget({ script, targetMinutes }: { script: string; targetMinutes?: number }) {
  const wc = countWords(script);
  const target = (targetMinutes ?? 10) * 150; // 150 wpm spoken
  const pct = target > 0 ? Math.round((wc / target) * 100) : 0;
  const inRange = pct >= 80 && pct <= 110;

  return (
    <div className="sa-wc-target">
      <div className="sa-wc-bar-bg">
        <div
          className={`sa-wc-bar-fill ${inRange ? "sa-wc-green" : "sa-wc-amber"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="sa-wc-label">
        <span>{wc} / {target} words</span>
        <span className={inRange ? "sa-wc-green-text" : "sa-wc-amber-text"}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

// ─── Section Markers ───

function ScriptBodyWithSections({ script }: { script: string }) {
  // Split by [SECTION: name] markers
  const sectionRegex = /\[SECTION:\s*([^\]]+)\]/g;
  const parts: Array<{ type: "text" | "marker"; content: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(script)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: script.slice(lastIndex, match.index) });
    }
    parts.push({ type: "marker", content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < script.length) {
    parts.push({ type: "text", content: script.slice(lastIndex) });
  }

  if (parts.length <= 1) {
    return <div className="sa-script-body">{renderScriptTextWithSourceNotes(script)}</div>;
  }

  return (
    <div className="sa-script-body">
      {parts.map((part, i) =>
        part.type === "marker" ? (
          <div key={i} className="sa-section-divider">
            <span className="sa-section-line" />
            <span className="sa-section-name">{part.content}</span>
            <span className="sa-section-line" />
          </div>
        ) : (
          <span key={i} style={{ whiteSpace: "pre-wrap" }}>
            {renderScriptTextWithSourceNotes(part.content)}
          </span>
        )
      )}
    </div>
  );
}

// ─── Research Tab ───

function ResearchTab({
  sources,
  claims,
  quotes,
}: {
  sources: ScriptAgentRun["sources"];
  claims: ScriptAgentRun["claims"];
  quotes: Array<{
    id: string;
    quoteText: string;
    sourceLabel: string;
    speaker: string | null;
    sourceUrl: string | null;
    startMs: number | null;
  }>;
}) {
  return (
    <div className="sa-research-layout">
      <div className="sa-research-col">
        <div className="sa-sidebar-label">Sources ({sources.length})</div>
        <div className="sa-list">
          {sources.map((src) => (
            <div key={src.id} className="sa-source-card">
              <div className="sa-source-title">{src.title}</div>
              <div className="sa-source-meta">
                {src.providerName} · {src.sourceKind.replaceAll("_", " ")}
              </div>
              {src.url ? (
                <div className="sa-quote-links">
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noreferrer"
                    className="sa-link"
                  >
                    open source ↗
                  </a>
                  {src.providerName === "youtube" ? (
                    <a
                      href={
                        buildLibraryQuotesHref({
                          provider: src.providerName,
                          sourceUrl: src.url,
                          title: src.title,
                        }) ?? src.url
                      }
                      className="sa-link"
                    >
                      see quotes
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {sources.length === 0 && (
            <div className="sa-empty-small">No sources collected.</div>
          )}
        </div>
      </div>
      <div className="sa-research-col">
        <div className="sa-sidebar-label">Quotes ({quotes.length})</div>
        <div className="sa-list">
          {quotes.map((q) => {
            const libraryQuotesHref = buildLibraryQuotesHref({
              sourceUrl: q.sourceUrl,
              title: q.sourceLabel,
            });

            return (
              <div key={q.id} className="sa-quote-card">
                <p className="sa-quote-text">&ldquo;{q.quoteText}&rdquo;</p>
                <div className="sa-quote-meta">
                  {q.sourceLabel}
                  {q.speaker ? ` · ${q.speaker}` : ""}
                </div>
                <div className="sa-quote-links">
                  {q.sourceUrl && (
                    <a
                      href={q.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="sa-link"
                    >
                      source ↗
                    </a>
                  )}
                  {libraryQuotesHref ? (
                    <a href={libraryQuotesHref} className="sa-link">
                      see quotes
                    </a>
                  ) : null}
                  {q.startMs !== null && (
                    <a
                      href={
                        buildTimestampUrl(q.sourceUrl, q.startMs) ?? undefined
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="sa-link"
                    >
                      {formatTimestamp(q.startMs)}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
          {quotes.length === 0 && (
            <div className="sa-empty-small">No quotes extracted.</div>
          )}
        </div>
      </div>
      <div className="sa-research-col">
        <div className="sa-sidebar-label">Claims ({claims.length})</div>
        <div className="sa-list">
          {claims.map((c) => (
            <div key={c.id} className="sa-claim-card">
              <p className="sa-claim-text">{c.claimText}</p>
              <div className="sa-claim-meta">
                support: {c.supportLevel} · risk: {c.riskLevel}
              </div>
            </div>
          ))}
          {claims.length === 0 && (
            <div className="sa-empty-small">No claims extracted.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───

const detailStyles = `
.sa-root {
  min-height: calc(100vh - 32px);
  background: #080808;
  color: #999;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 11px;
}

/* Header */
.sa-header { padding: 16px 24px 12px; border-bottom: 1px solid #151515; }
.sa-back { font-size: 10px; color: #444; text-decoration: none; transition: color 0.12s; }
.sa-back:hover { color: #5b9; }
.sa-header-main { margin-top: 10px; display: flex; align-items: flex-start; gap: 16px; }
.sa-header-left { flex: 1; }
.sa-title { font-size: 20px; font-weight: 700; color: #ccc; letter-spacing: -0.5px; margin-bottom: 8px; }
.sa-header-meta { display: flex; align-items: center; gap: 0; flex-wrap: wrap; font-size: 10px; color: #555; }
.sa-meta-text { padding: 0 2px; }
.sa-meta-accent { color: #5b9; }
.sa-meta-warn { color: #c93; }
.sa-meta-sep { color: #222; padding: 0 6px; }

/* Badges */
.sa-badge { font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 2px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 4px; }
.sa-badge-green { background: #1a2a1e; color: #5b9; }
.sa-badge-red { background: #2a0f0f; color: #a44; }
.sa-badge-blue { background: #0f1a2a; color: #68a; }
.sa-badge-muted { background: #181818; color: #555; }

/* Tabs */
.sa-tabs { display: flex; gap: 0; border-bottom: 1px solid #151515; padding: 0 24px; background: #0a0a0a; }
.sa-tab { padding: 10px 20px; font-family: inherit; font-size: 11px; font-weight: 600; color: #555; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; transition: all 0.12s; display: flex; align-items: center; gap: 6px; }
.sa-tab:hover { color: #999; }
.sa-tab.active { color: #ccc; border-bottom-color: #5b9; }
.sa-tab-count { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 2px; background: #151515; color: #666; }
.sa-tab.active .sa-tab-count { background: #1a2a1e; color: #5b9; }

.sa-content { padding: 0 24px 24px; }

/* Toolbar */
.sa-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; gap: 8px; flex-wrap: wrap; }
.sa-toolbar-left { display: flex; gap: 6px; }
.sa-toolbar-right { display: flex; align-items: center; gap: 8px; }
.sa-toolbar-label { font-size: 10px; color: #444; }
.sa-tool-btn { font-family: inherit; font-size: 10px; font-weight: 600; padding: 5px 12px; border-radius: 3px; border: 1px solid #1a1a1a; background: #0c0c0c; color: #777; cursor: pointer; transition: all 0.12s; }
.sa-tool-btn:hover { background: #151515; color: #bbb; border-color: #333; }
.sa-tool-btn:disabled { opacity: 0.5; cursor: default; }
.sa-tool-save { background: #1a2a1e; color: #5b9; border-color: #2a3a2e; }
.sa-tool-save:hover { background: #2a3a2e; }
.sa-status-select { font-family: inherit; font-size: 10px; padding: 4px 8px; background: #0c0c0c; border: 1px solid #1a1a1a; border-radius: 3px; color: #999; outline: none; cursor: pointer; text-transform: capitalize; }

/* Empty state */
.sa-empty { text-align: center; padding: 60px 20px; color: #444; }
.sa-empty-icon { font-size: 28px; margin-bottom: 10px; }
.sa-empty-text { font-size: 13px; }
.sa-empty-small { padding: 16px; text-align: center; color: #333; font-size: 10px; }

/* Script layout */
.sa-script-layout { display: grid; grid-template-columns: 1fr 340px; gap: 20px; align-items: start; }
.sa-script-main { background: #0c0c0c; border: 1px solid #151515; border-radius: 4px; overflow: hidden; }
.sa-script-header { padding: 20px 24px 16px; border-bottom: 1px solid #111; }
.sa-script-title { font-size: 18px; font-weight: 700; color: #ddd; margin-bottom: 8px; }
.sa-script-deck { font-size: 12px; color: #5b9; line-height: 1.6; margin-bottom: 10px; }
.sa-script-stats { display: flex; align-items: center; font-size: 10px; color: #444; }
.sa-script-body { padding: 20px 24px 32px; white-space: pre-wrap; font-size: 13px; line-height: 1.9; color: #bbb; font-family: 'IBM Plex Mono', ui-monospace, monospace; }
.sa-source-note { color: #86bfa8; }
.sa-source-note-link { color: #9ad8ff; text-decoration: underline; text-underline-offset: 2px; }
.sa-source-note-link:hover { color: #c6ebff; }

/* Edit mode */
.sa-edit-area { display: flex; flex-direction: column; gap: 0; height: calc(100vh - 240px); }
.sa-edit-field { padding: 10px 16px 0; }
.sa-edit-field-grow { flex: 1; display: flex; flex-direction: column; padding-bottom: 8px; }
.sa-edit-label { display: block; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #444; margin-bottom: 6px; }
.sa-edit-input { width: 100%; padding: 8px 12px; background: #111; border: 1px solid #1a1a1a; border-radius: 3px; color: #ccc; font-family: inherit; font-size: 13px; outline: none; }
.sa-edit-input:focus { border-color: #333; }
.sa-edit-textarea { flex: 1; width: 100%; padding: 12px 16px; background: #111; border: 1px solid #1a1a1a; border-radius: 3px; color: #bbb; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 13px; line-height: 1.9; outline: none; resize: none; }
.sa-edit-textarea:focus { border-color: #333; }

/* Sidebar */
.sa-script-sidebar { display: flex; flex-direction: column; gap: 12px; }
.sa-sidebar-card { background: #0c0c0c; border: 1px solid #151515; border-radius: 4px; padding: 14px 16px; }
.sa-sidebar-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #444; margin-bottom: 10px; }
.sa-sidebar-sublabel { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #333; margin-bottom: 6px; margin-top: 10px; }
.sa-sidebar-text { font-size: 11px; line-height: 1.6; color: #999; }
.sa-clickable { cursor: pointer; user-select: none; }
.sa-clickable:hover { color: #666; }

/* Feedback */
.sa-feedback-input-row { display: flex; gap: 6px; margin-bottom: 10px; }
.sa-feedback-input { flex: 1; padding: 6px 10px; background: #111; border: 1px solid #1a1a1a; border-radius: 3px; color: #bbb; font-family: inherit; font-size: 11px; outline: none; }
.sa-feedback-input:focus { border-color: #333; }
.sa-feedback-input::placeholder { color: #333; }
.sa-feedback-add { width: 28px; height: 28px; background: #1a2a1e; border: none; border-radius: 3px; color: #5b9; font-size: 14px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.sa-feedback-add:hover { background: #2a3a2e; }
.sa-feedback-add:disabled { opacity: 0.3; cursor: default; }
.sa-feedback-list { display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow-y: auto; }
.sa-feedback-item { padding: 8px 10px; background: #111; border: 1px solid #1a1a1a; border-radius: 3px; border-left: 2px solid #c93; }
.sa-feedback-item.resolved { opacity: 0.5; border-left-color: #5b9; }
.sa-feedback-body { font-size: 11px; color: #bbb; line-height: 1.5; margin-bottom: 4px; }
.sa-feedback-meta { display: flex; align-items: center; gap: 8px; font-size: 9px; color: #444; }
.sa-feedback-anchor { background: #151515; padding: 1px 5px; border-radius: 2px; }
.sa-feedback-actions { margin-left: auto; display: flex; gap: 4px; }
.sa-fb-btn { width: 18px; height: 18px; background: #181818; border: none; border-radius: 2px; color: #5b9; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.sa-fb-btn:hover { background: #222; }
.sa-fb-del { color: #a44; }

/* Moon analysis */
.sa-moon-score { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.sa-moon-num { font-size: 28px; font-weight: 700; color: #5b9; }
.sa-moon-band { font-size: 11px; color: #5b9; }
.sa-moon-tag { display: inline-block; font-size: 9px; padding: 2px 7px; background: #111; border: 1px solid #1a1a1a; border-radius: 2px; color: #666; margin-right: 4px; margin-bottom: 4px; }
.sa-analogs { margin-top: 8px; }
.sa-analog-item { font-size: 10px; color: #666; padding: 4px 0; border-bottom: 1px solid #111; }
.sa-analog-item:last-child { border-bottom: none; }

/* Beats */
.sa-beats-list { list-style: none; padding: 0; margin: 0; }
.sa-beat-item { font-size: 11px; color: #888; line-height: 1.5; padding: 5px 0; border-bottom: 1px solid #111; display: flex; gap: 8px; }
.sa-beat-item:last-child { border-bottom: none; }
.sa-beat-num { color: #333; font-weight: 700; flex-shrink: 0; width: 16px; }

/* Warnings */
.sa-warnings-card { border-color: #2a1a00; }
.sa-warning-item { font-size: 10px; color: #c93; padding: 4px 0; border-bottom: 1px solid #1a1500; line-height: 1.5; }
.sa-warning-item:last-child { border-bottom: none; }

/* History */
.sa-history-list { display: flex; flex-direction: column; gap: 4px; }
.sa-history-item { display: flex; align-items: center; gap: 8px; font-size: 10px; padding: 4px 0; border-bottom: 1px solid #111; }
.sa-history-item:last-child { border-bottom: none; }
.sa-history-ver { color: #5b9; font-weight: 700; width: 24px; }
.sa-history-status { color: #666; flex: 1; text-transform: capitalize; }
.sa-history-date { color: #333; }

/* Research tab */
.sa-research-layout { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; align-items: start; padding-top: 16px; }
.sa-list { display: flex; flex-direction: column; gap: 6px; }
.sa-source-card { background: #0c0c0c; border: 1px solid #151515; border-radius: 3px; padding: 10px 12px; }
.sa-source-title { font-size: 11px; color: #bbb; line-height: 1.4; margin-bottom: 4px; }
.sa-source-meta { font-size: 9px; color: #444; }
.sa-quote-card { background: #0c0c0c; border: 1px solid #151515; border-radius: 3px; padding: 10px 12px; }
.sa-quote-text { font-size: 11px; color: #bbb; line-height: 1.5; margin-bottom: 6px; }
.sa-quote-meta { font-size: 9px; color: #444; margin-bottom: 4px; }
.sa-quote-links { display: flex; gap: 10px; }
.sa-link { font-size: 9px; color: #5b9; text-decoration: none; }
.sa-link:hover { color: #7dc; }
.sa-claim-card { background: #0c0c0c; border: 1px solid #151515; border-radius: 3px; padding: 10px 12px; }
.sa-claim-text { font-size: 11px; color: #bbb; line-height: 1.5; margin-bottom: 6px; }
.sa-claim-meta { font-size: 9px; color: #444; }

.sa-pipeline-wrap { max-width: 100%; padding-top: 16px; }

/* Word count target */
.sa-wc-target { padding: 8px 24px 4px; }
.sa-wc-bar-bg { height: 4px; background: #151515; border-radius: 2px; overflow: hidden; }
.sa-wc-bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
.sa-wc-green { background: #5b9; }
.sa-wc-amber { background: #c93; }
.sa-wc-label { display: flex; justify-content: space-between; font-size: 9px; color: #444; margin-top: 4px; }
.sa-wc-green-text { color: #5b9; }
.sa-wc-amber-text { color: #c93; }

/* Section dividers */
.sa-section-divider { display: flex; align-items: center; gap: 12px; padding: 16px 0; }
.sa-section-line { flex: 1; height: 1px; background: #222; }
.sa-section-name { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #5b9; white-space: nowrap; }
`;
