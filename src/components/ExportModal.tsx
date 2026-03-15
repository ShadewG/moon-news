"use client";

import {
  X,
  Download,
  Monitor,
  Film,
  FileVideo,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useState } from "react";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const [format, setFormat] = useState<"mp4" | "mov" | "webm">("mp4");
  const [resolution, setResolution] = useState<"1080p" | "4K" | "720p">("1080p");
  const [exporting, setExporting] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-[480px] rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Download size={18} className="text-[var(--accent-blue)]" />
            <h2 className="text-base font-semibold">Export Project</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Format */}
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">
              Format
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["mp4", "mov", "webm"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm transition-colors ${
                    format === f
                      ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]"
                      : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-light)]"
                  }`}
                >
                  <FileVideo size={14} />
                  .{f}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">
              Resolution
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["720p", "1080p", "4K"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm transition-colors ${
                    resolution === r
                      ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]"
                      : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-light)]"
                  }`}
                >
                  <Monitor size={14} />
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">Timeline items</span>
              <span className="text-xs text-[var(--text-secondary)]">7 assets</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">Duration</span>
              <span className="text-xs text-[var(--text-secondary)]">1:57</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">Output</span>
              <span className="text-xs font-mono text-[var(--text-secondary)]">
                {resolution} · .{format}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">Storage</span>
              <span className="text-xs font-mono text-[var(--text-muted)]">
                /data/media/projects/proj_01/exports/
              </span>
            </div>
          </div>

          {/* Trigger.dev note */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--accent-blue)]/5 border border-[var(--accent-blue)]/10">
            <Film size={12} className="text-[var(--accent-blue)] shrink-0" />
            <span className="text-[10px] text-[var(--text-muted)]">
              Export runs as a Trigger.dev background task. You can close this dialog — you&apos;ll be notified when complete.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => setExporting(true)}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue-hover)] transition-colors disabled:opacity-50"
          >
            {exporting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Starting export...
              </>
            ) : (
              <>
                <Download size={14} />
                Start Export
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
