"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { ScriptLabSavedRun } from "@/lib/script-lab";

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

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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

export default function ScriptLabDetail({ run }: { run: ScriptLabSavedRun }) {
  const [edit, setEdit] = useState<EditData | null>(null);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [editHistory, setEditHistory] = useState<EditData[]>([]);

  const runKind = "lab";

  useEffect(() => {
    apiGet(run.id, runKind).then((data) => {
      setEdit(data.edit);
      setFeedback(data.feedback ?? []);
      setEditHistory(data.editHistory ?? []);
    });
  }, [run.id]);

  const bestVariant = run.result?.variants?.final ?? run.result?.variants?.hybrid ?? run.result?.variants?.claude ?? null;
  const bestDraft = bestVariant?.draft ?? null;

  const currentTitle = edit?.editedTitle ?? bestDraft?.title ?? run.storyTitle;
  const currentScript = edit?.editedScript ?? bestDraft?.script ?? "";
  const currentDeck = edit?.editedDeck ?? bestDraft?.deck ?? "";
  const editStatus = edit?.editStatus ?? "draft";

  // ─── Editing state ───
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(currentTitle);
  const [editScript, setEditScript] = useState(currentScript);
  const [editDeck, setEditDeck] = useState(currentDeck);
  const [saving, setSaving] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!editing) {
      setEditTitle(currentTitle);
      setEditScript(currentScript);
      setEditDeck(currentDeck);
    }
  }, [currentTitle, currentScript, currentDeck, editing]);

  // Keyboard shortcuts
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

  const handleSave = async () => {
    setSaving(true);
    const data = await apiPost(run.id, {
      action: "save_edit",
      kind: runKind,
      editedTitle: editTitle,
      editedScript: editScript,
      editedDeck: editDeck,
    });
    setEdit(data.edit);
    const refreshed = await apiGet(run.id, runKind);
    setEditHistory(refreshed.editHistory ?? []);
    setSaving(false);
    setEditing(false);
  };

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      if (!edit) {
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
    async () => {
      if (!feedbackText.trim()) return;
      const data = await apiPost(run.id, {
        action: "add_feedback",
        kind: runKind,
        body: feedbackText.trim(),
      });
      setFeedback((prev) => [data.feedback, ...prev]);
      setFeedbackText("");
    },
    [run.id, feedbackText]
  );

  const handleResolveFeedback = useCallback(
    async (feedbackId: string) => {
      await apiPost(run.id, { action: "resolve_feedback", kind: runKind, feedbackId });
      setFeedback((prev) => prev.map((f) => (f.id === feedbackId ? { ...f, resolved: true } : f)));
    },
    [run.id]
  );

  const handleDeleteFeedback = useCallback(
    async (feedbackId: string) => {
      await apiPost(run.id, { action: "delete_feedback", kind: runKind, feedbackId });
      setFeedback((prev) => prev.filter((f) => f.id !== feedbackId));
    },
    [run.id]
  );

  const statuses = ["draft", "in_review", "needs_revision", "approved", "final"];
  const openFeedback = feedback.filter((f) => !f.resolved).length;

  if (!bestDraft && !currentScript) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "#444", fontFamily: "'IBM Plex Mono', monospace" }}>
        <p>No script output in this lab run.</p>
        <Link href="/script-lab" style={{ color: "#5b9", fontSize: "12px" }}>← Back to Generate</Link>
      </div>
    );
  }

  return (
    <>
      <style>{labDetailStyles}</style>
      <div className="sa-root">
        <header className="sa-header">
          <Link href="/script-lab" className="sa-back">← Generate</Link>
          <div className="sa-header-main">
            <div className="sa-header-left">
              <h1 className="sa-title">{currentTitle}</h1>
              <div className="sa-header-meta">
                <span className="sa-badge sa-badge-muted">lab</span>
                <span className={`sa-badge ${editStatus === "approved" || editStatus === "final" ? "sa-badge-green" : editStatus === "needs_revision" ? "sa-badge-red" : "sa-badge-blue"}`}>{editStatus.replace("_", " ")}</span>
                <span className="sa-meta-text">{new Date(run.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                {currentScript && (
                  <>
                    <span className="sa-meta-sep">|</span>
                    <span className="sa-meta-text sa-meta-accent">{countWords(currentScript)} words</span>
                  </>
                )}
                {openFeedback > 0 && (
                  <>
                    <span className="sa-meta-sep">|</span>
                    <span className="sa-meta-text sa-meta-warn">{openFeedback} open notes</span>
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

        <main className="sa-content">
          <div className="sa-script-layout">
            <div className="sa-script-main">
              {/* Toolbar */}
              <div className="sa-toolbar">
                <div className="sa-toolbar-left">
                  {!editing ? (
                    <button className="sa-tool-btn" onClick={() => setEditing(true)}>&#9998; Edit</button>
                  ) : (
                    <>
                      <button className="sa-tool-btn sa-tool-save" onClick={handleSave} disabled={saving}>
                        {saving ? "Saving..." : "Save"}
                      </button>
                      <button className="sa-tool-btn" onClick={() => { setEditing(false); setEditTitle(currentTitle); setEditScript(currentScript); setEditDeck(currentDeck); }}>
                        Cancel
                      </button>
                    </>
                  )}
                  <button className="sa-tool-btn" onClick={() => { navigator.clipboard.writeText(currentScript); }}>Copy</button>
                </div>
                <div className="sa-toolbar-right">
                  <span className="sa-toolbar-label">Status:</span>
                  <select className="sa-status-select" value={editStatus} onChange={(e) => handleStatusChange(e.target.value)}>
                    {statuses.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                </div>
              </div>

              {/* Content */}
              {editing ? (
                <div className="sa-edit-area">
                  <div className="sa-edit-field">
                    <label className="sa-edit-label">Title</label>
                    <input className="sa-edit-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  </div>
                  <div className="sa-edit-field">
                    <label className="sa-edit-label">Deck</label>
                    <input className="sa-edit-input" value={editDeck} onChange={(e) => setEditDeck(e.target.value)} />
                  </div>
                  <div className="sa-edit-field sa-edit-field-grow">
                    <label className="sa-edit-label">Script ({countWords(editScript)} words)</label>
                    <textarea className="sa-edit-textarea" value={editScript} onChange={(e) => setEditScript(e.target.value)} />
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
                      <span>~{Math.ceil(countWords(currentScript) / 150)} min read</span>
                    </div>
                  </div>
                  <div className="sa-script-body">{currentScript}</div>
                </>
              )}
            </div>

            {/* Sidebar */}
            <aside className="sa-script-sidebar">
              {/* Feedback */}
              <div className="sa-sidebar-card">
                <div className="sa-sidebar-label">Notes & Feedback ({openFeedback} open)</div>
                <div className="sa-feedback-input-row">
                  <input
                    className="sa-feedback-input"
                    placeholder="Add a note..."
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddFeedback(); } }}
                  />
                  <button className="sa-feedback-add" onClick={handleAddFeedback} disabled={!feedbackText.trim()}>+</button>
                </div>
                <div className="sa-feedback-list">
                  {feedback.map((f) => (
                    <div key={f.id} className={`sa-feedback-item${f.resolved ? " resolved" : ""}`}>
                      <p className="sa-feedback-body">{f.body}</p>
                      <div className="sa-feedback-meta">
                        <span>{timeAgo(f.createdAt)}</span>
                        <div className="sa-feedback-actions">
                          {!f.resolved && (
                            <button className="sa-fb-btn" onClick={() => handleResolveFeedback(f.id)}>&#10003;</button>
                          )}
                          <button className="sa-fb-btn sa-fb-del" onClick={() => handleDeleteFeedback(f.id)}>&#10005;</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {feedback.length === 0 && <div className="sa-empty-small">No notes yet.</div>}
                </div>
              </div>

              {/* Version History */}
              <div className="sa-sidebar-card">
                <div className="sa-sidebar-label sa-clickable" onClick={() => setShowHistory(!showHistory)}>
                  Version History ({editHistory.length}) {showHistory ? "\u25BE" : "\u25B8"}
                </div>
                {showHistory && (
                  <div className="sa-history-list">
                    {editHistory.map((h) => (
                      <div key={h.id} className="sa-history-item">
                        <span className="sa-history-ver">v{h.version}</span>
                        <span className="sa-history-status">{h.editStatus.replace("_", " ")}</span>
                        <span className="sa-history-date">{timeAgo(h.createdAt)}</span>
                      </div>
                    ))}
                    {editHistory.length === 0 && <div className="sa-empty-small">No edits yet.</div>}
                  </div>
                )}
              </div>
            </aside>
          </div>
        </main>
      </div>
    </>
  );
}

// Reuse the same styles from script-agent detail
const labDetailStyles = `
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
.sa-meta-warn { color: #c93; }
.sa-meta-sep { color: #222; padding: 0 6px; }
.sa-badge { font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 2px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 4px; }
.sa-badge-green { background: #1a2a1e; color: #5b9; }
.sa-badge-red { background: #2a0f0f; color: #a44; }
.sa-badge-blue { background: #0f1a2a; color: #68a; }
.sa-badge-muted { background: #181818; color: #555; }
.sa-content { padding: 0 24px 24px; }
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
.sa-empty-small { padding: 16px; text-align: center; color: #333; font-size: 10px; }
.sa-script-layout { display: grid; grid-template-columns: 1fr 340px; gap: 20px; align-items: start; }
.sa-script-main { background: #0c0c0c; border: 1px solid #151515; border-radius: 4px; overflow: hidden; }
.sa-script-header { padding: 20px 24px 16px; border-bottom: 1px solid #111; }
.sa-script-title { font-size: 18px; font-weight: 700; color: #ddd; margin-bottom: 8px; }
.sa-script-deck { font-size: 12px; color: #5b9; line-height: 1.6; margin-bottom: 10px; }
.sa-script-stats { display: flex; align-items: center; font-size: 10px; color: #444; }
.sa-script-body { padding: 20px 24px 32px; white-space: pre-wrap; font-size: 13px; line-height: 1.9; color: #bbb; font-family: 'IBM Plex Mono', ui-monospace, monospace; }
.sa-edit-area { display: flex; flex-direction: column; gap: 0; height: calc(100vh - 240px); }
.sa-edit-field { padding: 10px 16px 0; }
.sa-edit-field-grow { flex: 1; display: flex; flex-direction: column; padding-bottom: 8px; }
.sa-edit-label { display: block; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #444; margin-bottom: 6px; }
.sa-edit-input { width: 100%; padding: 8px 12px; background: #111; border: 1px solid #1a1a1a; border-radius: 3px; color: #ccc; font-family: inherit; font-size: 13px; outline: none; }
.sa-edit-input:focus { border-color: #333; }
.sa-edit-textarea { flex: 1; width: 100%; padding: 12px 16px; background: #111; border: 1px solid #1a1a1a; border-radius: 3px; color: #bbb; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 13px; line-height: 1.9; outline: none; resize: none; }
.sa-edit-textarea:focus { border-color: #333; }
.sa-script-sidebar { display: flex; flex-direction: column; gap: 12px; }
.sa-sidebar-card { background: #0c0c0c; border: 1px solid #151515; border-radius: 4px; padding: 14px 16px; }
.sa-sidebar-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #444; margin-bottom: 10px; }
.sa-clickable { cursor: pointer; user-select: none; }
.sa-clickable:hover { color: #666; }
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
.sa-feedback-actions { margin-left: auto; display: flex; gap: 4px; }
.sa-fb-btn { width: 18px; height: 18px; background: #181818; border: none; border-radius: 2px; color: #5b9; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.sa-fb-btn:hover { background: #222; }
.sa-fb-del { color: #a44; }
.sa-history-list { display: flex; flex-direction: column; gap: 4px; }
.sa-history-item { display: flex; align-items: center; gap: 8px; font-size: 10px; padding: 4px 0; border-bottom: 1px solid #111; }
.sa-history-item:last-child { border-bottom: none; }
.sa-history-ver { color: #5b9; font-weight: 700; width: 24px; }
.sa-history-status { color: #666; flex: 1; text-transform: capitalize; }
.sa-history-date { color: #333; }
`;
