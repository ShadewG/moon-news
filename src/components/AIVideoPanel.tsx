"use client";

import {
  Video,
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
  Image,
  AlertCircle,
} from "lucide-react";
import {
  formatTimestamp,
  type VideoGenerationJob,
} from "@/lib/sample-data";
import { useProjectContext } from "@/lib/project-context";
import { useVideoJobs } from "@/lib/hooks";

const statusConfig = {
  pending: { icon: Clock, color: "text-[var(--text-muted)]", label: "Pending" },
  queued: { icon: Clock, color: "text-[var(--accent-blue)]", label: "Queued" },
  running: { icon: Loader2, color: "text-[var(--accent-orange)]", label: "Generating" },
  complete: { icon: Check, color: "text-[var(--accent-green)]", label: "Complete" },
  failed: { icon: AlertCircle, color: "text-[var(--accent-red)]", label: "Failed" },
  needs_review: { icon: AlertCircle, color: "text-[var(--accent-yellow)]", label: "Review" },
};

export default function AIVideoPanel() {
  const { projectId, selectedLineId, selectedLine } = useProjectContext();
  const { data: jobs } = useVideoJobs(projectId, selectedLineId);
  const line = selectedLine;

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
              line.video_status === "complete"
                ? "bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
                : line.video_status === "running"
                ? "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]"
                : "bg-[var(--bg-hover)] text-[var(--text-muted)]"
            }`}>
              Video: {line.video_status}
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
          <Video size={16} className="text-[var(--accent-red)]" />
          <h3 className="text-sm font-semibold">AI Video</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--accent-green)]/10 text-[var(--accent-green)] font-medium">
            OpenAI Sora
          </span>
          {jobs.length > 0 && (
            <span className="text-xs text-[var(--text-muted)]">{jobs.length} jobs</span>
          )}
        </div>
        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
          <Wand2 size={12} />
          Generate Video
        </button>
      </div>

      {/* Jobs */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {jobs.length > 0 ? (
          jobs.map((job) => <VideoJobCard key={job.id} job={job} />)
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function VideoJobCard({ job }: { job: VideoGenerationJob }) {
  const status = statusConfig[job.status];
  const StatusIcon = status.icon;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--border-light)] transition-colors group overflow-hidden">
      {/* Preview */}
      <div className="relative h-44 bg-[var(--bg-tertiary)] overflow-hidden">
        <div className="w-full h-full bg-gradient-to-br from-[var(--bg-tertiary)] via-[var(--accent-red)]/5 to-[var(--bg-elevated)] flex items-center justify-center">
          <Video size={28} className="text-[var(--text-muted)]/20" />
        </div>

        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <span className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md glass ${status.color}`}>
            <StatusIcon size={10} className={job.status === "running" ? "animate-spin" : ""} />
            {status.label}
          </span>
        </div>

        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md glass text-[var(--accent-green)]">
            OpenAI
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md glass text-[var(--text-secondary)]">
            {job.model}
          </span>
        </div>

        {job.status === "running" && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--bg-primary)]">
            <div
              className="h-full bg-gradient-to-r from-[var(--accent-red)] to-[var(--accent-orange)] transition-all duration-1000"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        )}

        {job.status === "complete" && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
            <button className="w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white/30 transition-colors">
              <Play size={22} className="text-white ml-0.5" />
            </button>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Palette size={12} className="text-[var(--accent-purple)]" />
          <span className="text-xs font-semibold text-[var(--accent-purple)]">{job.style_label}</span>
        </div>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">
          {job.prompt}
        </p>

        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1">
            <Cpu size={10} className="text-[var(--text-muted)]" />
            <span className="text-[10px] text-[var(--text-muted)]">{job.model}</span>
          </div>
          {job.source_image_asset_id && (
            <div className="flex items-center gap-1">
              <Image size={10} className="text-[var(--text-muted)]" />
              <span className="text-[10px] text-[var(--text-muted)]">
                Source: {job.source_image_asset_id}
              </span>
            </div>
          )}
          {job.status === "running" && (
            <span className="text-[10px] font-mono text-[var(--accent-orange)]">{job.progress}%</span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3">
          {job.status === "complete" ? (
            <>
              <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent-green)]/10 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/20 transition-colors">
                <Download size={12} />
                Add to Timeline
              </button>
              <button className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
                <RefreshCcw size={12} />
              </button>
            </>
          ) : job.status === "running" ? (
            <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-[var(--accent-orange)] bg-[var(--accent-orange)]/5">
              <Loader2 size={12} className="animate-spin" />
              Generating via Sora...
            </div>
          ) : job.status === "queued" ? (
            <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-[var(--accent-blue)] bg-[var(--accent-blue)]/5">
              <Clock size={12} />
              Queued
            </div>
          ) : (
            <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-[var(--accent-red)] to-[var(--accent-orange)] text-white hover:opacity-90 transition-opacity">
              <Wand2 size={12} />
              Generate Video
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--accent-red)]/10 to-[var(--accent-orange)]/10 flex items-center justify-center mb-4">
        <Video size={20} className="text-[var(--accent-red)]" />
      </div>
      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-1">No Videos Generated</h4>
      <p className="text-xs text-[var(--text-muted)] mb-4 max-w-[280px]">
        Generate video clips via OpenAI Sora. Optionally use an AI-generated image as a source frame for the video.
      </p>
      <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-[var(--accent-red)] to-[var(--accent-orange)] text-white hover:opacity-90 transition-opacity">
        <Wand2 size={14} />
        Generate with Sora
      </button>
    </div>
  );
}
