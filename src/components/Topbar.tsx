"use client";

import {
  Moon,
  Zap,
  ChevronDown,
  GitBranch,
  Loader2,
} from "lucide-react";
import { useProjectContext } from "@/lib/project-context";

const statusColors: Record<string, string> = {
  draft: "bg-[var(--accent-orange)]/15 text-[var(--accent-orange)]",
  active: "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]",
  in_progress: "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]",
  review: "bg-[var(--accent-purple)]/15 text-[var(--accent-purple)]",
  published: "bg-[var(--accent-green)]/15 text-[var(--accent-green)]",
  archived: "bg-[var(--text-muted)]/15 text-[var(--text-muted)]",
};

interface TopbarProps {
  onResearchAllClick: () => void;
  researchAllDisabled: boolean;
  researchAllRunning: boolean;
}

export default function Topbar({
  onResearchAllClick,
  researchAllDisabled,
  researchAllRunning,
}: TopbarProps) {
  const { project, lines } = useProjectContext();
  const title = project?.title ?? "Untitled Project";
  const status = project?.status ?? "draft";
  const versionNumber = 1;
  const hasLines = lines.length > 0;

  return (
    <header className="h-14 border-b border-[var(--border)] flex items-center justify-between px-4 glass">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
            <Moon size={18} className="text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight">
            Moon <span className="text-[var(--accent-blue)]">News</span>{" "}
            <span className="text-[var(--text-secondary)] font-normal">Studio</span>
          </span>
        </div>

        <div className="h-6 w-px bg-[var(--border)] mx-2" />

        <button className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
          <span className="text-sm text-[var(--text-secondary)]">Project:</span>
          <span className="text-sm font-medium">{title}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[status] ?? statusColors.draft}`}>
            {status.replace("_", " ")}
          </span>
          <ChevronDown size={12} className="text-[var(--text-muted)]" />
        </button>

        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--bg-tertiary)]">
          <GitBranch size={12} className="text-[var(--text-muted)]" />
          <span className="text-xs text-[var(--text-muted)]">v{versionNumber}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onResearchAllClick}
          disabled={researchAllDisabled || !hasLines}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {researchAllRunning ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          Research All
        </button>
      </div>
    </header>
  );
}
