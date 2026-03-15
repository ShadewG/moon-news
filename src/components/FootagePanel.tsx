"use client";

import {
  Film,
  ExternalLink,
  Download,
  Star,
  Eye,
} from "lucide-react";
import {
  sampleFootage,
  sampleScript,
  formatTimestamp,
  type FootageAsset,
} from "@/lib/sample-data";

const providerColors: Record<string, { bg: string; text: string; label: string }> = {
  storyblocks: { bg: "bg-[var(--accent-blue)]/10", text: "text-[var(--accent-blue)]", label: "Storyblocks" },
  artlist: { bg: "bg-[var(--accent-purple)]/10", text: "text-[var(--accent-purple)]", label: "Artlist" },
};

function formatFootageDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `0:${String(secs).padStart(2, "0")}`;
}

function formatResolution(w: number, h: number): string {
  if (w >= 3840) return "4K";
  if (w >= 1920) return "1080p";
  if (w >= 1280) return "720p";
  return `${w}x${h}`;
}

interface FootagePanelProps {
  selectedLine: string;
}

export default function FootagePanel({ selectedLine }: FootagePanelProps) {
  const footage = sampleFootage[selectedLine] || [];
  const line = sampleScript.find((l) => l.id === selectedLine);

  const storyblocksCount = footage.filter((f) => f.provider === "storyblocks").length;
  const artlistCount = footage.filter((f) => f.provider === "artlist").length;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Line context */}
      {line && (
        <div className="p-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {formatTimestamp(line.timestamp_start_ms)}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              line.footage_status === "complete"
                ? "bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
                : line.footage_status === "running"
                ? "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]"
                : "bg-[var(--bg-hover)] text-[var(--text-muted)]"
            }`}>
              Footage: {line.footage_status}
            </span>
          </div>
          <p className="text-sm text-[var(--text-primary)] leading-relaxed line-clamp-2">
            {line.text}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film size={16} className="text-[var(--accent-purple)]" />
          <h3 className="text-sm font-semibold">Source Footage</h3>
          {footage.length > 0 && (
            <span className="text-xs text-[var(--text-muted)]">
              {footage.length} clips
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {storyblocksCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]">
              Storyblocks: {storyblocksCount}
            </span>
          )}
          {artlistCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--accent-purple)]/10 text-[var(--accent-purple)]">
              Artlist: {artlistCount}
            </span>
          )}
        </div>
      </div>

      {/* Footage Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {footage.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {footage.map((clip) => (
              <FootageCard key={clip.id} clip={clip} />
            ))}
          </div>
        ) : (
          <EmptyFootageState />
        )}
      </div>
    </div>
  );
}

function FootageCard({ clip }: { clip: FootageAsset }) {
  const provider = providerColors[clip.provider];

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--border-light)] transition-colors group overflow-hidden">
      {/* Thumbnail */}
      <div className="relative h-40 bg-[var(--bg-tertiary)] overflow-hidden">
        <div className="w-full h-full bg-gradient-to-br from-[var(--bg-tertiary)] to-[var(--bg-elevated)] flex items-center justify-center">
          <Film size={32} className="text-[var(--text-muted)]/30" />
        </div>

        {/* Provider badge */}
        <div className="absolute top-2 left-2">
          <span className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md glass ${provider.text}`}>
            {provider.label}
          </span>
        </div>

        <div className="absolute top-2 right-2">
          <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
            <Star size={9} className="text-[var(--accent-yellow)]" />
            {clip.match_score}%
          </span>
        </div>

        <div className="absolute bottom-2 left-2">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
            {formatFootageDuration(clip.duration_ms)}
          </span>
        </div>

        <div className="absolute bottom-2 right-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
            {formatResolution(clip.width, clip.height)}
          </span>
        </div>

        {/* Play Overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <button className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white/30 transition-colors">
            <Eye size={18} className="text-white" />
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h4 className="text-sm font-medium text-[var(--text-primary)] leading-snug">
          {clip.title}
        </h4>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-[var(--text-muted)]">
            ID: {clip.external_asset_id}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">{clip.license_type}</span>
            <span className={`text-xs font-medium ${
              clip.price_label === "Free" || clip.price_label === "Included"
                ? "text-[var(--accent-green)]"
                : "text-[var(--text-secondary)]"
            }`}>
              {clip.price_label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20 transition-colors">
            <Download size={12} />
            Add to Timeline
          </button>
          <button className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
            <ExternalLink size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyFootageState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-12 h-12 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
        <Film size={20} className="text-[var(--text-muted)]" />
      </div>
      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-1">No Footage Found</h4>
      <p className="text-xs text-[var(--text-muted)] mb-4 max-w-[280px]">
        Search Storyblocks and Artlist for matching source footage for this script line.
      </p>
      <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent-purple)] text-white hover:opacity-90 transition-opacity">
        <Film size={14} />
        Search Footage
      </button>
    </div>
  );
}
