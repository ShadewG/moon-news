"use client";

import { Film, Sparkles, Music, Mic, Image, Volume2 } from "lucide-react";
import { formatTimestamp, type ScriptLine } from "@/lib/sample-data";
import { useProjectContext } from "@/lib/project-context";
import { useTimeline } from "@/lib/hooks";

const totalDurationMs = 117000;

function getSegmentColor(line: ScriptLine): string {
  if (line.research_status === "complete" && line.footage_status === "complete")
    return "from-[var(--accent-green)]/40 to-[var(--accent-green)]/20";
  if (line.research_status === "complete")
    return "from-[var(--accent-blue)]/40 to-[var(--accent-blue)]/20";
  if (line.research_status === "running" || line.research_status === "queued")
    return "from-[var(--accent-orange)]/40 to-[var(--accent-orange)]/20";
  return "from-[var(--bg-hover)] to-[var(--bg-tertiary)]";
}

export default function Timeline() {
  const { projectId, lines, selectedLineId, setSelectedLineId } = useProjectContext();
  const { data: timelineItems } = useTimeline(projectId);

  const videoItems = timelineItems.filter((t) => t.track_type === "video");
  const aiImageItems = timelineItems.filter((t) => t.track_type === "ai-image");
  const aiVideoItems = timelineItems.filter((t) => t.track_type === "ai-video");
  const musicItems = timelineItems.filter((t) => t.track_type === "music");
  const narrationItems = timelineItems.filter((t) => t.track_type === "narration");

  return (
    <div className="h-[160px] border-t border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
      {/* Timeline Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">Timeline</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] font-mono">00:00</span>
            <div className="w-[200px] h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div className="w-[30%] h-full bg-[var(--accent-blue)] rounded-full" />
            </div>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">
              {formatTimestamp(totalDurationMs)}
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
            {timelineItems.length} items · 5 tracks
          </span>
        </div>
      </div>

      {/* Tracks */}
      <div className="flex-1 px-4 py-1.5 overflow-x-auto space-y-1">
        {/* Video track */}
        <TrackRow icon={Film} label="Video" color="text-[var(--text-muted)]">
          {lines.map((line) => {
            const pct = (line.duration_ms / totalDurationMs) * 100;
            const hasTimelineItem = videoItems.some((t) => t.script_line_id === line.id);
            return (
              <button
                key={line.id}
                onClick={() => setSelectedLineId(line.id)}
                className={`h-7 rounded-md bg-gradient-to-b transition-all relative ${
                  hasTimelineItem ? getSegmentColor(line) : "from-[var(--bg-hover)]/50 to-[var(--bg-tertiary)]/50"
                } ${
                  selectedLineId === line.id
                    ? "ring-1 ring-[var(--accent-blue)] ring-offset-1 ring-offset-[var(--bg-secondary)]"
                    : "hover:brightness-125"
                }`}
                style={{ width: `${pct}%`, minWidth: "20px" }}
                title={line.text.slice(0, 60)}
              >
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden px-1">
                  <span className="text-[7px] text-white/40 truncate">
                    {formatTimestamp(line.timestamp_start_ms)}
                  </span>
                </div>
              </button>
            );
          })}
        </TrackRow>

        {/* AI Image track */}
        <TrackRow icon={Image} label="AI Img" color="text-[var(--accent-orange)]">
          {lines.map((line) => {
            const pct = (line.duration_ms / totalDurationMs) * 100;
            const hasItem = aiImageItems.some((t) => t.script_line_id === line.id);
            return (
              <div
                key={line.id}
                className={`h-4 rounded-sm ${
                  hasItem
                    ? "bg-gradient-to-r from-[var(--accent-orange)]/30 to-[var(--accent-yellow)]/30 border border-[var(--accent-orange)]/20"
                    : "bg-[var(--bg-tertiary)]/20"
                }`}
                style={{ width: `${pct}%`, minWidth: "20px" }}
              />
            );
          })}
        </TrackRow>

        {/* AI Video track */}
        <TrackRow icon={Sparkles} label="AI Vid" color="text-[var(--accent-red)]">
          {lines.map((line) => {
            const pct = (line.duration_ms / totalDurationMs) * 100;
            const hasItem = aiVideoItems.some((t) => t.script_line_id === line.id);
            return (
              <div
                key={line.id}
                className={`h-4 rounded-sm ${
                  hasItem
                    ? "bg-gradient-to-r from-[var(--accent-red)]/30 to-[var(--accent-purple)]/30 border border-[var(--accent-red)]/20"
                    : "bg-[var(--bg-tertiary)]/20"
                }`}
                style={{ width: `${pct}%`, minWidth: "20px" }}
              />
            );
          })}
        </TrackRow>

        {/* Music track */}
        <TrackRow icon={Music} label="Music" color="text-[var(--accent-green)]">
          <div className="flex-1 h-4 rounded-sm bg-gradient-to-r from-[var(--accent-green)]/20 via-[var(--accent-green)]/30 to-[var(--accent-green)]/10 flex items-center justify-center border border-[var(--accent-green)]/15">
            <span className="text-[7px] text-[var(--accent-green)]/50">
              Dark Revelation — Artlist
            </span>
          </div>
        </TrackRow>

        {/* Narration track */}
        <TrackRow icon={Mic} label="Voice" color="text-[var(--accent-yellow)]">
          <div className="flex-1 h-4 rounded-sm bg-gradient-to-r from-[var(--accent-yellow)]/15 via-[var(--accent-yellow)]/25 to-[var(--accent-yellow)]/10 flex items-center justify-center border border-[var(--accent-yellow)]/15">
            <span className="text-[7px] text-[var(--accent-yellow)]/50">
              Narration · {formatTimestamp(totalDurationMs)}
            </span>
          </div>
        </TrackRow>
      </div>
    </div>
  );
}

function TrackRow({
  icon: Icon,
  label,
  color,
  children,
}: {
  icon: typeof Film;
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-14 shrink-0 flex items-center gap-1">
        <Icon size={9} className={color} />
        <span className={`text-[9px] ${color}`}>{label}</span>
      </div>
      <div className="flex-1 flex gap-[2px] rounded-md overflow-hidden p-[1px]">
        {children}
      </div>
    </div>
  );
}
