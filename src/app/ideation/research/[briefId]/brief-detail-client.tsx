"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ideationGet,
  ideationPost,
  ideationPatch,
  ideationDelete,
} from "@/lib/ideation-client";
import type { ResearchBriefRead } from "@/lib/ideation-types";

/* ── Brief field parsing ── */

const BRIEF_FIELDS = [
  { key: "angle", label: "Angle", header: "## Angle" },
  { key: "hook", label: "Hook", header: "## Hook" },
  { key: "why_now", label: "Why Now", header: "## Why Now" },
  { key: "pattern", label: "Pattern", header: "## Pattern" },
  { key: "ours", label: "How to Make It Ours", header: "## Ours" },
  { key: "titles", label: "Title Options", header: "## Titles" },
  { key: "coverage", label: "Coverage Plan", header: "## Coverage" },
  { key: "evidence", label: "Evidence", header: "## Evidence" },
  { key: "notes", label: "Notes", header: "## Notes" },
] as const;

type BriefFieldKey = (typeof BRIEF_FIELDS)[number]["key"];
type BriefFields = Record<BriefFieldKey, string>;

function parseBriefToFields(md: string | null): BriefFields {
  const empty: BriefFields = {
    angle: "",
    hook: "",
    why_now: "",
    pattern: "",
    ours: "",
    titles: "",
    coverage: "",
    evidence: "",
    notes: "",
  };
  if (!md) return empty;

  const fields = { ...empty };
  const lines = md.split("\n");
  let currentKey: BriefFieldKey | null = null;
  let currentLines: string[] = [];

  function flush() {
    if (currentKey) {
      fields[currentKey] = currentLines.join("\n").trim();
    }
  }

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    let matched = false;
    for (const field of BRIEF_FIELDS) {
      // Match "## Angle", "## angle", "## ANGLE", etc.
      if (
        trimmed === field.header.toLowerCase() ||
        trimmed === field.header.toLowerCase().replace("## ", "## ") // exact
      ) {
        flush();
        currentKey = field.key;
        currentLines = [];
        matched = true;
        break;
      }
    }
    // Also try fuzzy matching for common variations
    if (!matched) {
      for (const field of BRIEF_FIELDS) {
        const headerWord = field.header.replace("## ", "").toLowerCase();
        if (trimmed.startsWith("## ") && trimmed.includes(headerWord)) {
          flush();
          currentKey = field.key;
          currentLines = [];
          matched = true;
          break;
        }
      }
    }
    if (!matched && currentKey) {
      currentLines.push(line);
    }
  }
  flush();
  return fields;
}

function fieldsToMarkdown(fields: BriefFields): string {
  const parts: string[] = [];
  for (const { key, header } of BRIEF_FIELDS) {
    const val = fields[key].trim();
    if (val) {
      parts.push(`${header}\n${val}`);
    }
  }
  return parts.join("\n\n") + "\n";
}

/* ── Component ── */

interface Props {
  initialBrief: ResearchBriefRead;
}

export default function BriefDetailClient({ initialBrief }: Props) {
  const router = useRouter();
  const [brief, setBrief] = useState(initialBrief);
  const [viewMode, setViewMode] = useState<"form" | "raw">("form");
  const [fields, setFields] = useState<BriefFields>(() =>
    parseBriefToFields(initialBrief.brief_content),
  );
  const [rawContent, setRawContent] = useState(initialBrief.brief_content ?? "");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [researching, setResearching] = useState(
    initialBrief.status === "researching",
  );
  const [deleting, setDeleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isPolling = researching || brief.status === "researching";

  // Poll for status updates when researching
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const updated = await ideationGet<ResearchBriefRead>(
        `/research/${brief.id}`,
      );
      if (updated) {
        setBrief(updated);
        if (updated.status !== "researching") {
          setResearching(false);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          // Update form fields with new content
          setFields(parseBriefToFields(updated.brief_content));
          setRawContent(updated.brief_content ?? "");
        }
      }
    }, 3000);
  }, [brief.id]);

  useEffect(() => {
    if (isPolling) {
      startPolling();
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isPolling, startPolling]);

  function updateField(key: BriefFieldKey, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    const content = viewMode === "form" ? fieldsToMarkdown(fields) : rawContent;
    const result = await ideationPatch<ResearchBriefRead>(`/research/${brief.id}`, {
      brief_content: content,
    });
    if (result) {
      setBrief(result);
      setFields(parseBriefToFields(result.brief_content));
      setRawContent(result.brief_content ?? "");
    }
    setSaving(false);
  }

  async function handleRegenerateBrief() {
    setGenerating(true);
    const result = await ideationPost<ResearchBriefRead>(
      `/research/${brief.id}/generate-brief`,
    );
    if (result) {
      setBrief(result);
      setFields(parseBriefToFields(result.brief_content));
      setRawContent(result.brief_content ?? "");
    }
    setGenerating(false);
  }

  async function handleRunResearch() {
    setResearching(true);
    // Returns 202, then we poll
    await ideationPost(`/research/${brief.id}/generate-research`);
    startPolling();
  }

  async function handleDelete() {
    if (!confirm("Delete this research brief? This cannot be undone.")) return;
    setDeleting(true);
    const ok = await ideationDelete(`/research/${brief.id}`);
    if (ok) {
      router.push("/ideation/research");
    } else {
      setDeleting(false);
    }
  }

  // Sync form/raw when switching modes
  function switchMode(mode: "form" | "raw") {
    if (mode === "raw" && viewMode === "form") {
      setRawContent(fieldsToMarkdown(fields));
    } else if (mode === "form" && viewMode === "raw") {
      setFields(parseBriefToFields(rawContent));
    }
    setViewMode(mode);
  }

  const statusColor =
    brief.status === "complete"
      ? "var(--ib-positive-text)"
      : brief.status === "researching"
      ? "var(--ib-warn-text)"
      : "var(--ib-text-dim)";

  return (
    <div>
      {/* Header */}
      <div className="ib-page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/ideation/research"
            className="ib-btn"
            style={{ padding: "4px 10px" }}
          >
            &larr; Back
          </Link>
          <h2 style={{ margin: 0 }}>{brief.topic}</h2>
          <span
            className="ib-tag"
            style={{ color: statusColor, borderColor: statusColor }}
          >
            {brief.status.toUpperCase()}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="ib-btn"
            onClick={handleRegenerateBrief}
            disabled={generating || isPolling}
          >
            {generating ? "Generating..." : "Regenerate Brief"}
          </button>
          <button
            className="ib-btn ib-btn-primary"
            onClick={handleRunResearch}
            disabled={isPolling}
          >
            {isPolling ? "Researching..." : "Run Full Research"}
          </button>
          <button
            className="ib-btn"
            onClick={handleDelete}
            disabled={deleting}
            style={{
              color: "var(--ib-negative-text)",
              borderColor: "var(--ib-negative)",
            }}
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      {isPolling && (
        <div
          className="ib-panel"
          style={{
            padding: "10px 14px",
            borderColor: "var(--ib-warn)",
            color: "var(--ib-warn-text)",
            fontFamily: "var(--ib-mono)",
            fontSize: 11,
          }}
        >
          Research is in progress. Polling for updates...
        </div>
      )}

      {/* Brief Content */}
      <div className="ib-panel">
        <div className="ib-panel-head">
          <h3>Brief Content</h3>
          <div style={{ display: "flex", gap: 0 }}>
            <div className="ib-window-tabs">
              <button
                className={viewMode === "form" ? "active" : ""}
                onClick={() => switchMode("form")}
              >
                Form
              </button>
              <button
                className={viewMode === "raw" ? "active" : ""}
                onClick={() => switchMode("raw")}
              >
                Raw
              </button>
            </div>
            <button
              className="ib-btn ib-btn-primary"
              onClick={handleSave}
              disabled={saving}
              style={{ marginLeft: 10 }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        <div style={{ padding: 14 }}>
          {viewMode === "form" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {BRIEF_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label
                    style={{
                      display: "block",
                      fontFamily: "var(--ib-mono)",
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      color: "var(--ib-text-dim)",
                      marginBottom: 4,
                    }}
                  >
                    {label}
                  </label>
                  <textarea
                    className="ib-textarea"
                    value={fields[key]}
                    onChange={(e) => updateField(key, e.target.value)}
                    rows={3}
                    style={{ minHeight: 60 }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <textarea
              className="ib-textarea"
              value={rawContent}
              onChange={(e) => setRawContent(e.target.value)}
              style={{ minHeight: 400 }}
            />
          )}
        </div>
      </div>

      {/* Research Content */}
      {brief.research_content && (
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>Research Content</h3>
          </div>
          <div
            style={{
              padding: 14,
              whiteSpace: "pre-wrap",
              fontFamily: "var(--ib-mono)",
              fontSize: 12,
              lineHeight: 1.6,
              color: "var(--ib-text)",
            }}
          >
            {brief.research_content}
          </div>
        </div>
      )}
    </div>
  );
}
