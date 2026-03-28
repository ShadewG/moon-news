"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ideationGet, ideationPatch, ideationPost, fmtNum, fmtScore, timeAgo } from "@/lib/ideation-client";
import type {
  IdeaRead, IdeaGenerationJobRead, OutlierVideoRead,
  TrendClusterRead, VideoListResponse, WatchlistChannelRead,
} from "@/lib/ideation-types";

import OutliersTab from "./outliers-tab";
import TrendsTab from "./trends-tab";
import VideosTab from "./videos-tab";
import ArchiveTab from "./archive-tab";

type Tab = "ideas" | "outliers" | "trends" | "videos" | "archive";
type IdeaFilter = "all" | "new" | "approved" | "rejected";
const TABS: { key: Tab; label: string }[] = [
  { key: "ideas", label: "Ideas" },
  { key: "outliers", label: "Outliers" },
  { key: "trends", label: "Trends" },
  { key: "videos", label: "Videos" },
  { key: "archive", label: "Archive" },
];
const IDEA_WINDOWS = ["all", "24h", "7d", "30d"] as const;
const IDEA_FILTERS: IdeaFilter[] = ["all", "new", "approved", "rejected"];

const JOB_STORAGE_KEY = "ideation.activeIdeaJobId";
const JOB_WINDOW_KEY = "ideation.activeIdeaJobWindow";

export default function IdeasClient({
  initialIdeas,
  channels,
}: {
  initialIdeas: IdeaRead[];
  channels: WatchlistChannelRead[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tab = (searchParams.get("tab") as Tab) || "ideas";
  const highlight = searchParams.get("highlight");

  const [ideas, setIdeas] = useState(initialIdeas);
  const [ideaWindow, setIdeaWindow] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("ideation.ideasWindow") || "all";
    return "all";
  });
  const [ideaFilter, setIdeaFilter] = useState<IdeaFilter>("all");

  // Generation state
  const [genJobId, setGenJobId] = useState<number | null>(null);
  const [genStatus, setGenStatus] = useState("");
  const [genRunning, setGenRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTab = useCallback((t: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (t === "ideas") params.delete("tab");
    else params.set("tab", t);
    router.replace(`/ideation/ideas${params.toString() ? `?${params}` : ""}`, { scroll: false });
  }, [router, searchParams]);

  // Persist idea window
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("ideation.ideasWindow", ideaWindow);
  }, [ideaWindow]);

  // Restore active generation job
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedId = sessionStorage.getItem(JOB_STORAGE_KEY);
    if (storedId) {
      setGenJobId(Number(storedId));
      setGenRunning(true);
      pollJob(Number(storedId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight flash
  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`idea-${highlight}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("idea-flash");
      setTimeout(() => el.classList.remove("idea-flash"), 3000);
    }
  }, [highlight, ideas]);

  // Cleanup
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  // Filtered ideas
  const filteredIdeas = useMemo(() => {
    let list = ideas;
    if (ideaWindow !== "all") {
      list = list.filter((i) => i.generation_window === ideaWindow);
    }
    if (ideaFilter !== "all") {
      list = list.filter((i) => i.status === ideaFilter);
    }
    return list;
  }, [ideas, ideaWindow, ideaFilter]);

  // Refresh ideas
  const refreshIdeas = useCallback(async () => {
    const data = await ideationGet<IdeaRead[]>("/ideas");
    if (data) setIdeas(data);
  }, []);

  // Poll generation job
  const pollJob = useCallback(async (runId: number) => {
    const result = await ideationGet<IdeaGenerationJobRead>(`/ideas/generate-jobs/${runId}`);
    if (!result) {
      pollRef.current = setTimeout(() => pollJob(runId), 3000);
      return;
    }
    if (result.status === "completed") {
      setGenRunning(false);
      setGenJobId(null);
      sessionStorage.removeItem(JOB_STORAGE_KEY);
      sessionStorage.removeItem(JOB_WINDOW_KEY);
      setGenStatus(`Generated ${result.accepted_idea_count} ideas (${result.provider} / ${result.model_name}, ${result.iteration_count} iterations)`);
      refreshIdeas();
      return;
    }
    if (result.status === "failed") {
      setGenRunning(false);
      setGenJobId(null);
      sessionStorage.removeItem(JOB_STORAGE_KEY);
      setGenStatus(`Generation failed${result.error ? ": " + result.error : ""}`);
      return;
    }
    setGenStatus(`Job ${runId} is ${result.status}. Waiting for ${result.provider} / ${result.model_name}...`);
    pollRef.current = setTimeout(() => pollJob(runId), 2500);
  }, [refreshIdeas]);

  // Start generation
  async function startGeneration() {
    setGenStatus("Starting generation...");
    setGenRunning(true);
    const result = await ideationPost<IdeaGenerationJobRead>(`/ideas/generate-async?window=${ideaWindow}`);
    if (!result || !result.run_id) {
      setGenRunning(false);
      setGenStatus("Failed to start generation.");
      return;
    }
    setGenJobId(result.run_id);
    sessionStorage.setItem(JOB_STORAGE_KEY, String(result.run_id));
    sessionStorage.setItem(JOB_WINDOW_KEY, ideaWindow);
    setGenStatus(`Job ${result.run_id} queued...`);
    pollRef.current = setTimeout(() => pollJob(result.run_id), 2000);
  }

  // Update idea status
  async function updateStatus(ideaId: number, status: string) {
    const result = await ideationPatch<IdeaRead>(`/ideas/${ideaId}`, { status });
    if (result) {
      setIdeas((prev) => prev.map((i) => (i.id === ideaId ? { ...i, status } : i)));
    }
  }

  return (
    <div>
      <div className="ib-page-header">
        <h2>Ideas</h2>
      </div>

      {/* Tab bar */}
      <div className="ib-window-tabs" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Ideas tab */}
      {tab === "ideas" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div className="ib-window-tabs">
              {IDEA_WINDOWS.map((w) => (
                <button key={w} className={ideaWindow === w ? "active" : ""} onClick={() => setIdeaWindow(w)}>
                  {w.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="ib-window-tabs">
              {IDEA_FILTERS.map((f) => (
                <button key={f} className={ideaFilter === f ? "active" : ""} onClick={() => setIdeaFilter(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <button className="ib-btn ib-btn-primary" onClick={startGeneration} disabled={genRunning}>
              {genRunning ? "GENERATING..." : "GENERATE NOW"}
            </button>
            <span className="ib-meta">{genStatus}</span>
          </div>

          <div className="ib-meta" style={{ marginBottom: 10 }}>
            {filteredIdeas.length} ideas
          </div>

          {filteredIdeas.map((idea) => (
            <div key={idea.id} id={`idea-${idea.id}`} className="idea-row">
              <div className="idea-header">
                <span className="idea-title">{idea.title}</span>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span className="ib-tag" style={{
                    borderColor: idea.status === "approved" ? "var(--ib-positive)" : idea.status === "rejected" ? "var(--ib-negative)" : "var(--ib-border)",
                    color: idea.status === "approved" ? "var(--ib-positive-text)" : idea.status === "rejected" ? "var(--ib-negative-text)" : "var(--ib-text-dim)",
                  }}>
                    {idea.status}
                  </span>
                  <span className="ib-meta">{fmtScore(idea.confidence_score)}</span>
                </div>
              </div>
              <div className="idea-body">
                <div className="idea-field"><strong>Angle:</strong> {idea.angle}</div>
                <div className="idea-field"><strong>Hook:</strong> {idea.hook}</div>
                <div className="idea-field"><strong>Why now:</strong> {idea.why_now}</div>
              </div>
              <div className="idea-footer">
                <div style={{ display: "flex", gap: 4 }}>
                  {idea.status !== "approved" && (
                    <button className="ib-btn" style={{ color: "var(--ib-positive-text)" }} onClick={() => updateStatus(idea.id, "approved")}>APPROVE</button>
                  )}
                  {idea.status !== "rejected" && (
                    <button className="ib-btn" style={{ color: "var(--ib-negative-text)" }} onClick={() => updateStatus(idea.id, "rejected")}>REJECT</button>
                  )}
                  {idea.status !== "new" && (
                    <button className="ib-btn" onClick={() => updateStatus(idea.id, "new")}>RESET</button>
                  )}
                </div>
                <div className="ib-meta">
                  {idea.sources.length} sources · {idea.target_format} · {timeAgo(idea.created_at)}
                </div>
              </div>
              {idea.sources.length > 0 && (
                <div className="idea-sources">
                  {idea.sources.slice(0, 3).map((s) => (
                    <a key={s.video_id} href={s.source_url} target="_blank" rel="noopener noreferrer" className="idea-source">
                      {s.video_title} ({s.channel_title}, {fmtNum(s.latest_view_count)} views)
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}

          {filteredIdeas.length === 0 && (
            <div className="ib-panel" style={{ padding: 40, textAlign: "center" }}>
              <div className="ib-meta">No ideas match current filters. Try generating or changing the window.</div>
            </div>
          )}
        </div>
      )}

      {/* Sub-tabs */}
      {tab === "outliers" && <OutliersTab channels={channels} />}
      {tab === "trends" && <TrendsTab />}
      {tab === "videos" && <VideosTab channels={channels} />}
      {tab === "archive" && <ArchiveTab />}

      <style jsx>{`
        .idea-row {
          background: var(--ib-surface);
          border: 1px solid var(--ib-border);
          padding: 14px;
          margin-bottom: 8px;
          transition: border-color 0.15s;
        }
        .idea-row:hover { border-color: var(--ib-border-light); }
        .idea-row.idea-flash {
          background: rgba(122, 184, 122, 0.08);
          border-left: 3px solid var(--ib-positive);
        }
        .idea-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 8px;
        }
        .idea-title {
          font-size: 14px;
          font-weight: 500;
          color: var(--ib-text-bright);
          line-height: 1.3;
        }
        .idea-body { margin-bottom: 8px; }
        .idea-field {
          font-size: 12px;
          color: var(--ib-text);
          line-height: 1.5;
          margin-bottom: 2px;
        }
        .idea-field strong {
          color: var(--ib-text-dim);
          font-weight: 400;
          font-family: var(--ib-mono);
          font-size: 10px;
          text-transform: uppercase;
        }
        .idea-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .idea-sources {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid var(--ib-border);
        }
        .idea-source {
          display: block;
          font-size: 11px;
          color: var(--ib-text-dim);
          text-decoration: none;
          padding: 2px 0;
        }
        .idea-source:hover { color: var(--ib-text); }
      `}</style>
    </div>
  );
}
