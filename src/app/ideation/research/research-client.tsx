"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ideationPost, timeAgo } from "@/lib/ideation-client";
import type {
  ResearchBriefSummary,
  ResearchBriefRead,
  ExistingOutlineRead,
  GenerationRunRead,
} from "@/lib/ideation-types";

interface Props {
  initialBriefs: ResearchBriefSummary[];
  initialOutlines: ExistingOutlineRead[];
  initialReports: Record<string, unknown>[];
  initialGenerations: GenerationRunRead[];
}

export default function ResearchClient({
  initialBriefs,
  initialOutlines,
  initialReports,
  initialGenerations,
}: Props) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    const result = await ideationPost<ResearchBriefRead>("/research", { topic: trimmed });
    setCreating(false);
    if (result) {
      router.push(`/ideation/research/${result.id}`);
    }
  }

  const statusColor = (status: string) => {
    switch (status.toUpperCase()) {
      case "COMPLETE":
        return "var(--ib-positive-text)";
      case "BRIEF":
        return "var(--ib-warn-text)";
      default:
        return "var(--ib-text-dim)";
    }
  };

  const q = search.toLowerCase().trim();
  const filteredBriefs = q
    ? initialBriefs.filter((b) => b.topic.toLowerCase().includes(q) || b.status.toLowerCase().includes(q))
    : initialBriefs;
  const filteredOutlines = q
    ? initialOutlines.filter((o) => o.title.toLowerCase().includes(q) || o.source.toLowerCase().includes(q))
    : initialOutlines;
  const filteredReports = q
    ? initialReports.filter((r) => {
        const title = ((r.title as string) || (r.name as string) || "").toLowerCase();
        return title.includes(q);
      })
    : initialReports;

  return (
    <div>
      <div className="ib-page-header">
        <h2>Research</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="ib-input"
            style={{ width: 280 }}
            placeholder="Search briefs, outlines, reports..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Create Brief */}
      <div className="ib-panel">
        <div className="ib-panel-head">
          <h3>New Brief</h3>
        </div>
        <form
          onSubmit={handleCreate}
          style={{ padding: 14, display: "flex", gap: 10, alignItems: "center" }}
        >
          <input
            className="ib-input"
            placeholder="Enter a topic..."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="submit"
            className="ib-btn ib-btn-primary"
            disabled={creating || !topic.trim()}
          >
            {creating ? "Creating..." : "Generate Brief"}
          </button>
        </form>
      </div>

      {/* Research Briefs table */}
      <div className="ib-panel">
        <div className="ib-panel-head">
          <h3>Research Briefs</h3>
          <span className="ib-meta">{filteredBriefs.length} briefs</span>
        </div>
        <table className="ib-table">
          <thead>
            <tr>
              <th>Topic</th>
              <th>Status</th>
              <th>Created</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredBriefs.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  style={{ color: "var(--ib-text-dim)", textAlign: "center", padding: 20 }}
                >
                  No research briefs yet.
                </td>
              </tr>
            )}
            {filteredBriefs.map((b) => (
              <tr
                key={b.id}
                style={{ cursor: "pointer" }}
                onClick={() => router.push(`/ideation/research/${b.id}`)}
              >
                <td style={{ color: "var(--ib-text-bright)" }}>{b.topic}</td>
                <td>
                  <span
                    className="ib-tag"
                    style={{
                      color: statusColor(b.status),
                      borderColor: statusColor(b.status),
                    }}
                  >
                    {b.status.toUpperCase()}
                  </span>
                </td>
                <td className="ib-meta">{timeAgo(b.created_at)}</td>
                <td>
                  <Link
                    href={`/ideation/research/${b.id}`}
                    className="ib-panel-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    VIEW &rarr;
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ib-grid-2">
        {/* Existing Outlines */}
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>Existing Outlines</h3>
            <span className="ib-meta">{filteredOutlines.length} outlines</span>
          </div>
          <table className="ib-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Source</th>
                <th>Sections</th>
                <th>Clips</th>
              </tr>
            </thead>
            <tbody>
              {filteredOutlines.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    style={{ color: "var(--ib-text-dim)", textAlign: "center", padding: 20 }}
                  >
                    No outlines found.
                  </td>
                </tr>
              )}
              {filteredOutlines.map((o) => (
                <tr
                  key={`${o.source}-${o.source_id}`}
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    router.push(`/ideation/outlines/${o.source}/${o.source_id}`)
                  }
                >
                  <td style={{ color: "var(--ib-text-bright)" }}>{o.title}</td>
                  <td>
                    <span className="ib-tag">{o.source}</span>
                  </td>
                  <td
                    style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-text-dim)" }}
                  >
                    {o.section_count}
                  </td>
                  <td
                    style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-text-dim)" }}
                  >
                    {o.clip_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Script Reports */}
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>Script Reports</h3>
            <span className="ib-meta">{filteredReports.length} reports</span>
          </div>
          <div style={{ padding: filteredReports.length === 0 ? 0 : undefined }}>
            {filteredReports.length === 0 && (
              <div
                style={{
                  color: "var(--ib-text-dim)",
                  textAlign: "center",
                  padding: 20,
                }}
              >
                No script reports.
              </div>
            )}
            {filteredReports.map((r, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 14px",
                  borderBottom: "1px solid var(--ib-border)",
                  cursor: "pointer",
                }}
              >
                <span style={{ color: "var(--ib-text-bright)", fontSize: 12 }}>
                  {(r.title as string) || (r.name as string) || `Report ${i + 1}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Generation History — hidden when searching */}
      {!q && <div className="ib-panel">
        <div className="ib-panel-head">
          <h3>Generation History</h3>
          <span className="ib-meta">{initialGenerations.length} runs</span>
        </div>
        <table className="ib-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Summary</th>
              <th>Model</th>
              <th>Status</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {initialGenerations.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{ color: "var(--ib-text-dim)", textAlign: "center", padding: 20 }}
                >
                  No generation runs yet.
                </td>
              </tr>
            )}
            {initialGenerations.map((g) => (
              <tr key={g.id}>
                <td>
                  <span className="ib-tag">{g.run_type}</span>
                </td>
                <td style={{ color: "var(--ib-text)", maxWidth: 300 }}>
                  {g.input_summary}
                  {g.error && (
                    <span
                      style={{
                        color: "var(--ib-negative-text)",
                        fontSize: 11,
                        display: "block",
                        marginTop: 2,
                      }}
                    >
                      {g.error}
                    </span>
                  )}
                </td>
                <td className="ib-meta">{g.model_name}</td>
                <td>
                  <span
                    className="ib-tag"
                    style={{
                      color:
                        g.status === "completed"
                          ? "var(--ib-positive-text)"
                          : g.status === "failed"
                          ? "var(--ib-negative-text)"
                          : "var(--ib-warn-text)",
                      borderColor:
                        g.status === "completed"
                          ? "var(--ib-positive-text)"
                          : g.status === "failed"
                          ? "var(--ib-negative-text)"
                          : "var(--ib-warn-text)",
                    }}
                  >
                    {g.status}
                  </span>
                </td>
                <td className="ib-meta">{timeAgo(g.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  );
}
