"use client";

import { useState } from "react";
import {
  Search,
  Plus,
  FileText,
  CheckCircle2,
  Loader2,
  Clock,
  AlertCircle,
  Sparkles,
  BookOpen,
  Film,
  Image,
  Video,
} from "lucide-react";
import {
  sampleScript,
  computeAggregateStatus,
  formatTimestamp,
  formatDuration,
  type ScriptLine,
  type JobStatus,
} from "@/lib/sample-data";

const domainStatusIcons: Record<JobStatus, typeof CheckCircle2> = {
  pending: Clock,
  queued: Clock,
  running: Loader2,
  complete: CheckCircle2,
  failed: AlertCircle,
  needs_review: AlertCircle,
};

const domainStatusColors: Record<JobStatus, string> = {
  pending: "text-[var(--text-muted)]",
  queued: "text-[var(--accent-blue)]/50",
  running: "text-[var(--accent-blue)]",
  complete: "text-[var(--accent-green)]",
  failed: "text-[var(--accent-red)]",
  needs_review: "text-[var(--accent-orange)]",
};

const typeColors = {
  narration: "border-l-[var(--accent-blue)]",
  quote: "border-l-[var(--accent-yellow)]",
  transition: "border-l-[var(--text-muted)]",
  headline: "border-l-[var(--accent-orange)]",
};

interface ScriptPanelProps {
  selectedLine: string;
  onSelectLine: (id: string) => void;
}

export default function ScriptPanel({ selectedLine, onSelectLine }: ScriptPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredLines = sampleScript.filter((line) =>
    line.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const counts = {
    complete: sampleScript.filter((l) => l.research_status === "complete").length,
    running: sampleScript.filter((l) => l.research_status === "running" || l.research_status === "queued").length,
    pending: sampleScript.filter((l) => l.research_status === "pending").length,
    failed: sampleScript.filter((l) => l.research_status === "failed").length,
  };

  return (
    <div className="w-[380px] min-w-[380px] border-r border-[var(--border)] flex flex-col bg-[var(--bg-secondary)]">
      {/* Header */}
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-[var(--text-secondary)]" />
            <h2 className="text-sm font-semibold">Script</h2>
            <span className="text-xs text-[var(--text-muted)]">
              {sampleScript.length} lines
            </span>
          </div>
          <button className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors">
            <Plus size={14} />
          </button>
        </div>

        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            placeholder="Search script lines..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)]/50 transition-colors"
          />
        </div>
      </div>

      {/* Stats Bar */}
      <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[var(--accent-green)]" />
          <span className="text-xs text-[var(--text-muted)]">{counts.complete} done</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)]" />
          <span className="text-xs text-[var(--text-muted)]">{counts.running} running</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
          <span className="text-xs text-[var(--text-muted)]">{counts.pending} pending</span>
        </div>
        {counts.failed > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[var(--accent-red)]" />
            <span className="text-xs text-[var(--accent-red)]">{counts.failed} failed</span>
          </div>
        )}
      </div>

      {/* Script Lines */}
      <div className="flex-1 overflow-y-auto">
        {filteredLines.map((line) => (
          <ScriptLineItem
            key={line.id}
            line={line}
            isSelected={selectedLine === line.id}
            onClick={() => onSelectLine(line.id)}
          />
        ))}
      </div>

      {/* Import */}
      <div className="p-3 border-t border-[var(--border)]">
        <button className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-[var(--border-light)] text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--accent-blue)]/30 hover:bg-[var(--bg-tertiary)] transition-colors">
          <Sparkles size={14} />
          Import or paste new script
        </button>
      </div>
    </div>
  );
}

function DomainDot({ status, label }: { status: JobStatus; label: string }) {
  const Icon = domainStatusIcons[status];
  const color = domainStatusColors[status];
  return (
    <div className="flex items-center gap-0.5" title={`${label}: ${status}`}>
      <Icon size={9} className={`${color} ${status === "running" ? "animate-spin" : ""}`} />
    </div>
  );
}

function ScriptLineItem({
  line,
  isSelected,
  onClick,
}: {
  line: ScriptLine;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 border-b border-[var(--border)] border-l-2 transition-all ${
        typeColors[line.line_type]
      } ${
        isSelected
          ? "bg-[var(--accent-blue)]/5 border-l-[var(--accent-blue)]"
          : "hover:bg-[var(--bg-tertiary)]"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-mono text-[var(--text-muted)] mt-1 min-w-[36px]">
          {formatTimestamp(line.timestamp_start_ms)}
        </span>
        <div className="flex-1 min-w-0">
          <p
            className={`text-xs leading-relaxed ${
              line.line_type === "transition"
                ? "text-[var(--text-muted)] italic"
                : line.line_type === "quote"
                ? "text-[var(--accent-yellow)]/80"
                : "text-[var(--text-secondary)]"
            } ${isSelected ? "text-[var(--text-primary)]" : ""}`}
          >
            {line.text.length > 120 ? line.text.slice(0, 120) + "..." : line.text}
          </p>

          {/* Per-domain status dots */}
          <div className="flex items-center gap-3 mt-1.5">
            <div className="flex items-center gap-1">
              <BookOpen size={9} className="text-[var(--text-muted)]" />
              <DomainDot status={line.research_status} label="Research" />
            </div>
            <div className="flex items-center gap-1">
              <Film size={9} className="text-[var(--text-muted)]" />
              <DomainDot status={line.footage_status} label="Footage" />
            </div>
            <div className="flex items-center gap-1">
              <Image size={9} className="text-[var(--text-muted)]" />
              <DomainDot status={line.image_status} label="Image" />
            </div>
            <div className="flex items-center gap-1">
              <Video size={9} className="text-[var(--text-muted)]" />
              <DomainDot status={line.video_status} label="Video" />
            </div>

            <span className="text-[10px] text-[var(--text-muted)] ml-auto">
              {formatDuration(line.duration_ms)}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] capitalize">
              {line.line_type}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
