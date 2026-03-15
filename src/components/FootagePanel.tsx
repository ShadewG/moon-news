"use client";

import {
  Film,
  ExternalLink,
  ShoppingCart,
  Eye,
  Download,
  Star,
  MonitorPlay,
  Image,
  Archive,
  Newspaper,
  Tv,
} from "lucide-react";
import {
  sampleFootage,
  sampleScript,
  type FootageResult,
} from "@/lib/sample-data";

const typeConfig = {
  stock: { icon: Image, label: "Stock", color: "text-[var(--accent-blue)]" },
  news: { icon: Newspaper, label: "News", color: "text-[var(--accent-red)]" },
  documentary: {
    icon: MonitorPlay,
    label: "Documentary",
    color: "text-[var(--accent-purple)]",
  },
  archive: {
    icon: Archive,
    label: "Archive",
    color: "text-[var(--accent-yellow)]",
  },
  "b-roll": { icon: Tv, label: "B-Roll", color: "text-[var(--accent-green)]" },
};

interface FootagePanelProps {
  selectedLine: string;
}

export default function FootagePanel({ selectedLine }: FootagePanelProps) {
  const footage = sampleFootage[selectedLine] || [];

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film size={16} className="text-[var(--accent-purple)]" />
          <h3 className="text-sm font-semibold">Source Footage</h3>
          {footage.length > 0 && (
            <span className="text-xs text-[var(--text-muted)]">
              {footage.length} clips found
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md px-2 py-1 text-[var(--text-secondary)] focus:outline-none">
            <option>All Sources</option>
            <option>Stock Only</option>
            <option>Free / Public Domain</option>
            <option>News Archives</option>
          </select>
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

function FootageCard({ clip }: { clip: FootageResult }) {
  const typeInfo = typeConfig[clip.type];
  const TypeIcon = typeInfo.icon;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--border-light)] transition-colors group overflow-hidden">
      {/* Thumbnail */}
      <div className="relative h-40 bg-[var(--bg-tertiary)] overflow-hidden">
        <div className="w-full h-full bg-gradient-to-br from-[var(--bg-tertiary)] to-[var(--bg-elevated)] flex items-center justify-center">
          <Film size={32} className="text-[var(--text-muted)]/30" />
        </div>

        {/* Overlay Info */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <span
            className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md glass ${typeInfo.color}`}
          >
            <TypeIcon size={10} />
            {typeInfo.label}
          </span>
        </div>

        <div className="absolute top-2 right-2">
          <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
            <Star size={9} className="text-[var(--accent-yellow)]" />
            {clip.matchScore}%
          </span>
        </div>

        <div className="absolute bottom-2 left-2">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
            {clip.duration}
          </span>
        </div>

        <div className="absolute bottom-2 right-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
            {clip.resolution}
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
          <span className="text-xs text-[var(--accent-blue)]">
            {clip.source}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">
              {clip.license}
            </span>
            <span
              className={`text-xs font-medium ${
                clip.price === "Free"
                  ? "text-[var(--accent-green)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {clip.price}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3">
          <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20 transition-colors">
            <Download size={12} />
            Add to Timeline
          </button>
          <button className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
            <ExternalLink size={12} />
          </button>
          {clip.price !== "Free" && (
            <button className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
              <ShoppingCart size={12} />
            </button>
          )}
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
      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-1">
        No Footage Found
      </h4>
      <p className="text-xs text-[var(--text-muted)] mb-4 max-w-[280px]">
        Run research first, then search for matching source footage across stock
        libraries, news archives, and documentaries.
      </p>
      <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent-purple)] text-white hover:opacity-90 transition-opacity">
        <Film size={14} />
        Find Source Footage
      </button>
    </div>
  );
}
