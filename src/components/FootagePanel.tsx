"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Film,
  ExternalLink,
  Download,
  Star,
  Eye,
  Search,
  Image,
  Sparkles,
  Archive,
  X,
  PlayCircle,
  Filter,
} from "lucide-react";
import {
  formatTimestamp,
  type FootageAsset,
  type VisualRecommendation,
  type MediaType,
} from "@/lib/sample-data";
import { useProjectContext } from "@/lib/project-context";
import { useVisuals, useTriggerInvestigation } from "@/lib/hooks";
import * as api from "@/lib/api";

const providerColors: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  youtube: { bg: "bg-red-500/10", text: "text-red-500", label: "YouTube", icon: "YT" },
  internet_archive: { bg: "bg-amber-500/10", text: "text-amber-500", label: "Internet Archive", icon: "IA" },
  getty: { bg: "bg-emerald-500/10", text: "text-emerald-500", label: "Getty", icon: "G" },
  google_images: { bg: "bg-blue-500/10", text: "text-blue-500", label: "Google Images", icon: "GI" },
  storyblocks: { bg: "bg-[var(--accent-blue)]/10", text: "text-[var(--accent-blue)]", label: "Storyblocks", icon: "SB" },
  artlist: { bg: "bg-[var(--accent-purple)]/10", text: "text-[var(--accent-purple)]", label: "Artlist", icon: "AL" },
};

const mediaTypeLabels: Record<MediaType, string> = {
  video: "Video",
  image: "Image",
  stock_video: "Stock Video",
  stock_image: "Stock Image",
  article: "Article",
};

function formatFootageDuration(ms: number): string {
  if (!ms) return "";
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `0:${String(secs).padStart(2, "0")}`;
}

function formatResolution(w: number, h: number): string {
  if (!w || !h) return "";
  if (w >= 3840) return "4K";
  if (w >= 1920) return "1080p";
  if (w >= 1280) return "720p";
  return `${w}x${h}`;
}

type MediaFilter = "all" | MediaType;

export default function FootagePanel() {
  const { projectId, selectedLineId, selectedLine } = useProjectContext();
  const { data: visuals, refetch } = useVisuals(projectId, selectedLineId);
  const { trigger, triggering } = useTriggerInvestigation(projectId);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [showFiltered, setShowFiltered] = useState(false);
  const line = selectedLine;

  const { assets, recommendations } = visuals;

  // Auto-poll while footage is running
  useEffect(() => {
    if (line?.footage_status !== "running" && line?.footage_status !== "queued") return;
    const interval = setInterval(refetch, 3000);
    return () => clearInterval(interval);
  }, [line?.footage_status, refetch]);

  // Split assets into visible and filtered
  const { visibleAssets, filteredAssets, filteredCount } = useMemo(() => {
    const visible = assets.filter((a) => !a.filtered);
    const filtered = assets.filter((a) => a.filtered);
    return { visibleAssets: visible, filteredAssets: filtered, filteredCount: filtered.length };
  }, [assets]);

  const displayAssets = showFiltered ? assets : visibleAssets;

  const mediaFilteredAssets = mediaFilter === "all"
    ? displayAssets
    : displayAssets.filter((a) => a.media_type === mediaFilter);

  // Count by provider (visible only)
  const providerCounts: Record<string, number> = {};
  for (const asset of visibleAssets) {
    providerCounts[asset.provider] = (providerCounts[asset.provider] ?? 0) + 1;
  }

  const handleInvestigate = useCallback(async () => {
    if (!selectedLineId) return;
    await trigger(selectedLineId);
    refetch();
  }, [selectedLineId, trigger, refetch]);

  const handleDismiss = useCallback(async (recId: string) => {
    if (!projectId || !selectedLineId) return;
    await api.dismissRecommendation(projectId, selectedLineId, recId);
    refetch();
  }, [projectId, selectedLineId, refetch]);

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
                : line.footage_status === "running" || line.footage_status === "queued"
                ? "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]"
                : "bg-[var(--bg-hover)] text-[var(--text-muted)]"
            }`}>
              {line.footage_status === "queued" ? "Investigating..." : `Footage: ${line.footage_status}`}
            </span>
            {line.line_content_category && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)]">
                {line.line_content_category.replace(/_/g, " ")}
              </span>
            )}
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
          <h3 className="text-sm font-semibold">Visual Research</h3>
          {visibleAssets.length > 0 && (
            <span className="text-xs text-[var(--text-muted)]">
              {visibleAssets.length} results{filteredCount > 0 ? ` (+${filteredCount} filtered)` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {Object.entries(providerCounts).map(([provider, count]) => {
            const style = providerColors[provider];
            return style ? (
              <span
                key={provider}
                className={`text-[10px] px-1.5 py-0.5 rounded-md ${style.bg} ${style.text}`}
              >
                {style.icon}: {count}
              </span>
            ) : null;
          })}
        </div>
      </div>

      {/* Media type filters */}
      {(new Set(displayAssets.map((a) => a.media_type))).size > 1 && (
        <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-1.5">
          <Filter size={12} className="text-[var(--text-muted)]" />
          <button
            onClick={() => setMediaFilter("all")}
            className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
              mediaFilter === "all"
                ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            All
          </button>
          {(["video", "image", "stock_video", "stock_image"] as MediaType[]).map((mt) =>
            displayAssets.some((a) => a.media_type === mt) ? (
              <button
                key={mt}
                onClick={() => setMediaFilter(mt)}
                className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
                  mediaFilter === mt
                    ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {mediaTypeLabels[mt]}
              </button>
            ) : null
          )}
        </div>
      )}

      {/* AI Recommendations banner */}
      {recommendations.length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--border)]">
          {recommendations.map((rec) => (
            <RecommendationBanner
              key={rec.id}
              recommendation={rec}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}

      {/* Footage Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {(line?.footage_status === "running" || line?.footage_status === "queued") && assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-12 h-12 rounded-2xl bg-[var(--accent-blue)]/10 flex items-center justify-center mb-4 animate-pulse">
              <Search size={20} className="text-[var(--accent-blue)]" />
            </div>
            <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-1">
              Investigating...
            </h4>
            <p className="text-xs text-[var(--text-muted)] max-w-[280px]">
              Classifying line, searching YouTube, Internet Archive, and more.
            </p>
          </div>
        ) : mediaFilteredAssets.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {mediaFilteredAssets.map((clip) => (
              <FootageCard key={clip.id} clip={clip} />
            ))}
            {!showFiltered && filteredCount > 0 && (
              <button
                onClick={() => setShowFiltered(true)}
                className="py-3 rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-light)] transition-colors"
              >
                View {filteredCount} more (lower relevance)
              </button>
            )}
            {showFiltered && filteredCount > 0 && (
              <button
                onClick={() => setShowFiltered(false)}
                className="py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                Hide filtered results
              </button>
            )}
          </div>
        ) : (
          <EmptyFootageState onInvestigate={handleInvestigate} triggering={triggering} />
        )}
      </div>
    </div>
  );
}

function RecommendationBanner({
  recommendation,
  onDismiss,
}: {
  recommendation: VisualRecommendation;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--accent-purple)]/5 border border-[var(--accent-purple)]/20 mb-2 last:mb-0">
      <Sparkles size={16} className="text-[var(--accent-purple)] mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[var(--text-primary)]">
          Recommend AI {recommendation.recommendation_type === "ai_video" ? "video" : "image"} for this line
        </p>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{recommendation.reason}</p>
        {recommendation.suggested_prompt && (
          <p className="text-[10px] text-[var(--text-muted)] mt-1 italic line-clamp-1">
            Prompt: {recommendation.suggested_prompt}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <button className="text-[10px] px-2 py-1 rounded-md bg-[var(--accent-purple)] text-white hover:opacity-90 transition-opacity">
            Generate
          </button>
          <span className="text-[10px] text-[var(--text-muted)]">
            {Math.round(recommendation.confidence * 100)}% confidence
          </span>
        </div>
      </div>
      <button
        onClick={() => onDismiss(recommendation.id)}
        className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function FootageCard({ clip }: { clip: FootageAsset }) {
  const provider = providerColors[clip.provider] ?? {
    bg: "bg-[var(--bg-hover)]",
    text: "text-[var(--text-muted)]",
    label: clip.provider,
    icon: "?",
  };

  const isVideo = clip.media_type === "video" || clip.media_type === "stock_video";
  const hasPreview = clip.preview_url;

  return (
    <div className={`rounded-xl border bg-[var(--bg-secondary)] hover:border-[var(--border-light)] transition-colors group overflow-hidden ${
      clip.filtered ? "border-[var(--border)] opacity-60" : "border-[var(--border)]"
    }`}>
      {/* Filter reason badge */}
      {clip.filtered && clip.filter_reason && (
        <div className="px-3 py-1.5 bg-[var(--bg-hover)] border-b border-[var(--border)]">
          <span className="text-[10px] text-[var(--text-muted)]">Filtered: {clip.filter_reason}</span>
        </div>
      )}
      {/* Thumbnail */}
      <div className="relative h-40 bg-[var(--bg-tertiary)] overflow-hidden">
        {hasPreview ? (
          <img
            src={clip.preview_url!}
            alt={clip.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[var(--bg-tertiary)] to-[var(--bg-elevated)] flex items-center justify-center">
            {isVideo ? (
              <PlayCircle size={32} className="text-[var(--text-muted)]/30" />
            ) : (
              <Image size={32} className="text-[var(--text-muted)]/30" />
            )}
          </div>
        )}

        {/* Provider badge */}
        <div className="absolute top-2 left-2">
          <span className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md glass ${provider.text}`}>
            {provider.label}
          </span>
        </div>

        {/* Media type badge */}
        <div className="absolute top-2 left-auto right-auto" style={{ left: "50%", transform: "translateX(-50%)" }}>
          <span className="text-[9px] px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
            {mediaTypeLabels[clip.media_type] ?? clip.media_type}
          </span>
        </div>

        <div className="absolute top-2 right-2">
          <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
            <Star size={9} className="text-[var(--accent-yellow)]" />
            {clip.match_score}%
          </span>
        </div>

        {isVideo && clip.duration_ms > 0 && (
          <div className="absolute bottom-2 left-2">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
              {formatFootageDuration(clip.duration_ms)}
            </span>
          </div>
        )}

        {clip.width > 0 && clip.height > 0 && (
          <div className="absolute bottom-2 right-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
              {formatResolution(clip.width, clip.height)}
            </span>
          </div>
        )}

        {/* Primary source indicator */}
        {clip.is_primary_source && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
            <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-[var(--accent-green)]/20 text-[var(--accent-green)] font-medium">
              Primary Source
            </span>
          </div>
        )}

        {/* Play Overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <a
            href={clip.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white/30 transition-colors"
          >
            <Eye size={18} className="text-white" />
          </a>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h4 className="text-sm font-medium text-[var(--text-primary)] leading-snug line-clamp-2">
          {clip.title}
        </h4>
        {clip.channel_or_contributor && (
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            {clip.channel_or_contributor}
          </p>
        )}
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-[var(--text-muted)] truncate max-w-[160px]">
            {clip.external_asset_id.length > 30
              ? clip.external_asset_id.slice(0, 30) + "..."
              : clip.external_asset_id}
          </span>
          <div className="flex items-center gap-2">
            {clip.license_type && (
              <span className="text-[10px] text-[var(--text-muted)]">{clip.license_type}</span>
            )}
            {clip.upload_date && (
              <span className="text-[10px] text-[var(--text-muted)]">
                {clip.upload_date.slice(0, 10)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20 transition-colors">
            <Download size={12} />
            Add to Timeline
          </button>
          <a
            href={clip.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
}

function EmptyFootageState({
  onInvestigate,
  triggering,
}: {
  onInvestigate: () => void;
  triggering: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-12 h-12 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
        <Search size={20} className="text-[var(--text-muted)]" />
      </div>
      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-1">No Visuals Found</h4>
      <p className="text-xs text-[var(--text-muted)] mb-4 max-w-[280px]">
        Run video-first investigation to search YouTube, Internet Archive, Google Images, and more.
      </p>
      <button
        onClick={onInvestigate}
        disabled={triggering}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent-purple)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        <Search size={14} />
        {triggering ? "Starting..." : "Investigate Line"}
      </button>
    </div>
  );
}
