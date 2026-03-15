"use client";

import {
  Clapperboard,
  Download,
  Play,
  Settings,
  Share2,
  Zap,
} from "lucide-react";

export default function Topbar() {
  return (
    <header className="h-14 border-b border-[var(--border)] flex items-center justify-between px-4 glass">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
            <Clapperboard size={18} className="text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight">
            Source<span className="text-[var(--accent-blue)]">Reel</span>
          </span>
        </div>

        <div className="h-6 w-px bg-[var(--border)] mx-2" />

        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-secondary)]">Project:</span>
          <span className="text-sm font-medium">CIA Podcast Infiltration</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-orange)]/15 text-[var(--accent-orange)] font-medium">
            Draft
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <Zap size={14} />
          Auto-Research All
        </button>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <Play size={14} />
          Preview
        </button>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <Share2 size={14} />
          Share
        </button>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <Settings size={14} />
        </button>

        <div className="h-6 w-px bg-[var(--border)] mx-1" />

        <button className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue-hover)] transition-colors">
          <Download size={14} />
          Export
        </button>
      </div>
    </header>
  );
}
