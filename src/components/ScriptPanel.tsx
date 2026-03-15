"use client";

import { useState } from "react";
import {
  Search,
  Plus,
  FileText,
  CheckCircle2,
  Loader2,
  Clock,
  Film,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { sampleScript, type ScriptLine } from "@/lib/sample-data";

const statusConfig = {
  researched: {
    icon: CheckCircle2,
    color: "text-[var(--accent-green)]",
    bg: "bg-[var(--accent-green)]/10",
    label: "Researched",
  },
  "in-progress": {
    icon: Loader2,
    color: "text-[var(--accent-blue)]",
    bg: "bg-[var(--accent-blue)]/10",
    label: "Researching",
  },
  pending: {
    icon: Clock,
    color: "text-[var(--text-muted)]",
    bg: "bg-[var(--bg-hover)]",
    label: "Pending",
  },
  "footage-found": {
    icon: Film,
    color: "text-[var(--accent-purple)]",
    bg: "bg-[var(--accent-purple)]/10",
    label: "Footage Ready",
  },
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
          <div className="flex items-center gap-1">
            <button className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors">
              <Plus size={14} />
            </button>
          </div>
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
      <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[var(--accent-green)]" />
          <span className="text-xs text-[var(--text-muted)]">5 researched</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)]" />
          <span className="text-xs text-[var(--text-muted)]">2 in progress</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
          <span className="text-xs text-[var(--text-muted)]">5 pending</span>
        </div>
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

      {/* Import/Paste */}
      <div className="p-3 border-t border-[var(--border)]">
        <button className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-[var(--border-light)] text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--accent-blue)]/30 hover:bg-[var(--bg-tertiary)] transition-colors">
          <Sparkles size={14} />
          Import or paste new script
        </button>
      </div>
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
  const status = statusConfig[line.status];
  const StatusIcon = status.icon;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 border-b border-[var(--border)] border-l-2 transition-all ${
        typeColors[line.type]
      } ${
        isSelected
          ? "bg-[var(--accent-blue)]/5 border-l-[var(--accent-blue)]"
          : "hover:bg-[var(--bg-tertiary)]"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-mono text-[var(--text-muted)] mt-1 min-w-[36px]">
          {line.timestamp}
        </span>
        <div className="flex-1 min-w-0">
          <p
            className={`text-xs leading-relaxed ${
              line.type === "transition"
                ? "text-[var(--text-muted)] italic"
                : line.type === "quote"
                ? "text-[var(--accent-yellow)]/80"
                : "text-[var(--text-secondary)]"
            } ${isSelected ? "text-[var(--text-primary)]" : ""}`}
          >
            {line.text.length > 120
              ? line.text.slice(0, 120) + "..."
              : line.text}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span
              className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md ${status.bg} ${status.color}`}
            >
              <StatusIcon
                size={10}
                className={
                  line.status === "in-progress" ? "animate-spin" : ""
                }
              />
              {status.label}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              {line.duration}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] capitalize">
              {line.type}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
