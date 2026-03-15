"use client";

import {
  Sparkles,
  Play,
  RefreshCcw,
  Download,
  Wand2,
  Loader2,
  Check,
  Clock,
  Palette,
  Cpu,
  Timer,
} from "lucide-react";
import {
  sampleAIOptions,
  sampleScript,
  type AIVideoOption,
} from "@/lib/sample-data";

const statusConfig = {
  ready: {
    icon: Wand2,
    color: "text-[var(--accent-blue)]",
    bg: "bg-[var(--accent-blue)]/10",
    label: "Ready",
  },
  generating: {
    icon: Loader2,
    color: "text-[var(--accent-orange)]",
    bg: "bg-[var(--accent-orange)]/10",
    label: "Generating",
  },
  complete: {
    icon: Check,
    color: "text-[var(--accent-green)]",
    bg: "bg-[var(--accent-green)]/10",
    label: "Complete",
  },
  queued: {
    icon: Clock,
    color: "text-[var(--text-muted)]",
    bg: "bg-[var(--bg-hover)]",
    label: "Queued",
  },
};

interface AIVideoPanelProps {
  selectedLine: string;
}

export default function AIVideoPanel({ selectedLine }: AIVideoPanelProps) {
  const options = sampleAIOptions[selectedLine] || [];

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-[var(--accent-orange)]" />
          <h3 className="text-sm font-semibold">AI Video Generation</h3>
          {options.length > 0 && (
            <span className="text-xs text-[var(--text-muted)]">
              {options.length} options
            </span>
          )}
        </div>
        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
          <RefreshCcw size={12} />
          Generate New
        </button>
      </div>

      {/* AI Options */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {options.length > 0 ? (
          options.map((option) => (
            <AIVideoCard key={option.id} option={option} />
          ))
        ) : (
          <EmptyAIState />
        )}
      </div>
    </div>
  );
}

function AIVideoCard({ option }: { option: AIVideoOption }) {
  const status = statusConfig[option.status];
  const StatusIcon = status.icon;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--border-light)] transition-colors group overflow-hidden">
      {/* Thumbnail / Preview */}
      <div className="relative h-36 bg-[var(--bg-tertiary)] overflow-hidden">
        <div className="w-full h-full bg-gradient-to-br from-[var(--bg-tertiary)] via-[var(--accent-purple)]/5 to-[var(--bg-elevated)] flex items-center justify-center">
          <Sparkles size={28} className="text-[var(--text-muted)]/20" />
        </div>

        {/* Status Badge */}
        <div className="absolute top-2 left-2">
          <span
            className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md glass ${status.color}`}
          >
            <StatusIcon
              size={10}
              className={option.status === "generating" ? "animate-spin" : ""}
            />
            {status.label}
          </span>
        </div>

        <div className="absolute top-2 right-2">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
            {option.model}
          </span>
        </div>

        {/* Progress Bar for generating */}
        {option.status === "generating" && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--bg-primary)]">
            <div
              className="h-full bg-gradient-to-r from-[var(--accent-orange)] to-[var(--accent-yellow)] transition-all duration-1000"
              style={{ width: `${option.progress}%` }}
            />
          </div>
        )}

        {/* Play overlay for complete */}
        {option.status === "complete" && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
            <button className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white/30 transition-colors">
              <Play size={18} className="text-white ml-0.5" />
            </button>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Palette size={12} className="text-[var(--accent-purple)]" />
          <span className="text-xs font-semibold text-[var(--accent-purple)]">
            {option.style}
          </span>
        </div>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          {option.description}
        </p>

        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1">
            <Cpu size={10} className="text-[var(--text-muted)]" />
            <span className="text-[10px] text-[var(--text-muted)]">
              {option.model}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Timer size={10} className="text-[var(--text-muted)]" />
            <span className="text-[10px] text-[var(--text-muted)]">
              {option.estimatedTime}
            </span>
          </div>
          {option.status === "generating" && (
            <span className="text-[10px] font-mono text-[var(--accent-orange)]">
              {option.progress}%
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3">
          {option.status === "ready" ? (
            <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white hover:opacity-90 transition-opacity">
              <Wand2 size={12} />
              Generate
            </button>
          ) : option.status === "complete" ? (
            <>
              <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent-green)]/10 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/20 transition-colors">
                <Download size={12} />
                Add to Timeline
              </button>
              <button className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
                <RefreshCcw size={12} />
              </button>
            </>
          ) : option.status === "generating" ? (
            <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-[var(--accent-orange)] bg-[var(--accent-orange)]/5">
              <Loader2 size={12} className="animate-spin" />
              Generating...
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-[var(--text-muted)] bg-[var(--bg-hover)]">
              <Clock size={12} />
              In Queue
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyAIState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--accent-blue)]/10 to-[var(--accent-purple)]/10 flex items-center justify-center mb-4">
        <Sparkles size={20} className="text-[var(--accent-purple)]" />
      </div>
      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-1">
        No AI Videos Yet
      </h4>
      <p className="text-xs text-[var(--text-muted)] mb-4 max-w-[280px]">
        Generate AI video clips for this script line using Sora, Runway, or Kling.
        Choose a visual style and we&apos;ll create it.
      </p>
      <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white hover:opacity-90 transition-opacity">
        <Sparkles size={14} />
        Generate AI Video
      </button>
    </div>
  );
}
