"use client";

import {
  ExternalLink,
  BookOpen,
  FileText,
  Video,
  GraduationCap,
  BookMarked,
  ThumbsUp,
  Copy,
  RotateCcw,
  Star,
} from "lucide-react";
import {
  sampleResearch,
  sampleScript,
  type ResearchResult,
} from "@/lib/sample-data";

const typeIcons = {
  article: FileText,
  document: BookOpen,
  book: BookMarked,
  video: Video,
  academic: GraduationCap,
};

const typeColors = {
  article: "text-[var(--accent-blue)]",
  document: "text-[var(--accent-green)]",
  book: "text-[var(--accent-purple)]",
  video: "text-[var(--accent-red)]",
  academic: "text-[var(--accent-yellow)]",
};

interface ResearchPanelProps {
  selectedLine: string;
}

export default function ResearchPanel({ selectedLine }: ResearchPanelProps) {
  const research = sampleResearch[selectedLine] || [];
  const line = sampleScript.find((l) => l.id === selectedLine);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Selected Line Context */}
      {line && (
        <div className="p-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {line.timestamp}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)] capitalize">
              {line.type}
            </span>
          </div>
          <p className="text-sm text-[var(--text-primary)] leading-relaxed">
            {line.text}
          </p>
        </div>
      )}

      {/* Research Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-[var(--accent-blue)]" />
          <h3 className="text-sm font-semibold">Deep Research</h3>
          {research.length > 0 && (
            <span className="text-xs text-[var(--text-muted)]">
              {research.length} sources found
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
            <RotateCcw size={12} />
            Re-research
          </button>
        </div>
      </div>

      {/* Research Results */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {research.length > 0 ? (
          research.map((result) => (
            <ResearchCard key={result.id} result={result} />
          ))
        ) : (
          <EmptyResearchState selectedLine={selectedLine} />
        )}
      </div>
    </div>
  );
}

function ResearchCard({ result }: { result: ResearchResult }) {
  const TypeIcon = typeIcons[result.type];

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--border-light)] transition-colors group">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-start gap-2 min-w-0">
            <div
              className={`mt-0.5 p-1 rounded-md bg-[var(--bg-tertiary)] ${typeColors[result.type]}`}
            >
              <TypeIcon size={12} />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-[var(--text-primary)] leading-snug">
                {result.title}
              </h4>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-[var(--accent-blue)]">
                  {result.source}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {result.date}
                </span>
              </div>
            </div>
          </div>

          {/* Relevance Score */}
          <div className="flex items-center gap-1 shrink-0">
            <Star size={10} className="text-[var(--accent-yellow)]" />
            <span
              className={`text-xs font-mono font-medium ${
                result.relevanceScore >= 95
                  ? "text-[var(--accent-green)]"
                  : result.relevanceScore >= 85
                  ? "text-[var(--accent-blue)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {result.relevanceScore}%
            </span>
          </div>
        </div>

        {/* Snippet */}
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-2">
          {result.snippet}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
            <ExternalLink size={10} />
            Open Source
          </button>
          <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
            <Copy size={10} />
            Cite
          </button>
          <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
            <ThumbsUp size={10} />
            Use in Script
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyResearchState({ selectedLine }: { selectedLine: string }) {
  const line = sampleScript.find((l) => l.id === selectedLine);
  const isPending = line?.status === "pending";

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-12 h-12 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
        <BookOpen size={20} className="text-[var(--text-muted)]" />
      </div>
      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-1">
        {isPending ? "Research Not Started" : "No Research Yet"}
      </h4>
      <p className="text-xs text-[var(--text-muted)] mb-4 max-w-[280px]">
        {isPending
          ? "Click below to start deep research on this script line. We'll find relevant sources, documents, and context."
          : "Select a researched line to view findings, or start research on this line."}
      </p>
      <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue-hover)] transition-colors">
        <BookOpen size={14} />
        Start Deep Research
      </button>
    </div>
  );
}
