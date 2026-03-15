"use client";

import { Film, Sparkles, Clock, Volume2 } from "lucide-react";
import { sampleScript } from "@/lib/sample-data";

const segmentColors: Record<string, string> = {
  "researched": "from-[var(--accent-green)]/40 to-[var(--accent-green)]/20",
  "in-progress": "from-[var(--accent-blue)]/40 to-[var(--accent-blue)]/20",
  "pending": "from-[var(--bg-hover)] to-[var(--bg-tertiary)]",
  "footage-found": "from-[var(--accent-purple)]/40 to-[var(--accent-purple)]/20",
};

interface TimelineProps {
  selectedLine: string;
  onSelectLine: (id: string) => void;
}

export default function Timeline({ selectedLine, onSelectLine }: TimelineProps) {
  return (
    <div className="h-[140px] border-t border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
      {/* Timeline Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">
            Timeline
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] font-mono">
              00:00
            </span>
            <div className="w-[200px] h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div className="w-[30%] h-full bg-[var(--accent-blue)] rounded-full" />
            </div>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">
              01:57
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Volume2 size={12} className="text-[var(--text-muted)]" />
            <div className="w-16 h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div className="w-[75%] h-full bg-[var(--text-muted)] rounded-full" />
            </div>
          </div>
          <span className="text-[10px] text-[var(--text-muted)]">
            12 segments
          </span>
        </div>
      </div>

      {/* Timeline Tracks */}
      <div className="flex-1 px-4 py-2 overflow-x-auto">
        {/* Video Track */}
        <div className="flex items-center gap-1 mb-1.5">
          <div className="w-16 shrink-0 flex items-center gap-1">
            <Film size={10} className="text-[var(--text-muted)]" />
            <span className="text-[10px] text-[var(--text-muted)]">Video</span>
          </div>
          <div className="flex-1 flex gap-[2px] timeline-track rounded-md overflow-hidden p-[2px]">
            {sampleScript.map((line) => {
              const durationNum = parseInt(line.duration);
              const widthPercent = (durationNum / 117) * 100;

              return (
                <button
                  key={line.id}
                  onClick={() => onSelectLine(line.id)}
                  className={`h-8 rounded-md bg-gradient-to-b transition-all relative group ${
                    segmentColors[line.status]
                  } ${
                    selectedLine === line.id
                      ? "ring-1 ring-[var(--accent-blue)] ring-offset-1 ring-offset-[var(--bg-secondary)]"
                      : "hover:brightness-125"
                  }`}
                  style={{ width: `${widthPercent}%`, minWidth: "24px" }}
                  title={line.text.slice(0, 60)}
                >
                  {/* Tiny label */}
                  <div className="absolute inset-0 flex items-center justify-center overflow-hidden px-1">
                    <span className="text-[8px] text-white/50 truncate">
                      {line.timestamp}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* AI Track */}
        <div className="flex items-center gap-1 mb-1.5">
          <div className="w-16 shrink-0 flex items-center gap-1">
            <Sparkles size={10} className="text-[var(--text-muted)]" />
            <span className="text-[10px] text-[var(--text-muted)]">AI</span>
          </div>
          <div className="flex-1 flex gap-[2px] rounded-md overflow-hidden p-[2px]">
            {sampleScript.map((line) => {
              const durationNum = parseInt(line.duration);
              const widthPercent = (durationNum / 117) * 100;
              const hasAI = ["line-1", "line-2", "line-3", "line-10"].includes(
                line.id
              );

              return (
                <div
                  key={line.id}
                  className={`h-5 rounded-sm ${
                    hasAI
                      ? "bg-gradient-to-r from-[var(--accent-purple)]/30 to-[var(--accent-blue)]/30 border border-[var(--accent-purple)]/20"
                      : "bg-[var(--bg-tertiary)]/30"
                  }`}
                  style={{ width: `${widthPercent}%`, minWidth: "24px" }}
                />
              );
            })}
          </div>
        </div>

        {/* Audio Track */}
        <div className="flex items-center gap-1">
          <div className="w-16 shrink-0 flex items-center gap-1">
            <Clock size={10} className="text-[var(--text-muted)]" />
            <span className="text-[10px] text-[var(--text-muted)]">Audio</span>
          </div>
          <div className="flex-1 h-5 rounded-md bg-[var(--bg-tertiary)] overflow-hidden p-[2px]">
            <div className="w-full h-full rounded-sm bg-gradient-to-r from-[var(--accent-green)]/20 via-[var(--accent-green)]/30 to-[var(--accent-green)]/10 flex items-center justify-center">
              <span className="text-[8px] text-[var(--accent-green)]/60">
                Narration Track — 1:57
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
