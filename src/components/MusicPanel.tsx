"use client";

import {
  Music,
  Play,
  Download,
  Clock,
  Waves,
  Heart,
} from "lucide-react";
import { type MusicAsset } from "@/lib/sample-data";
import { useProjectContext } from "@/lib/project-context";
import { useMusic } from "@/lib/hooks";

function formatMusicDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function getWaveHeights(seed: string, length = 40) {
  return Array.from({ length }, (_, index) => {
    const charCode = seed.charCodeAt(index % seed.length) || 0;
    return 4 + ((charCode + index * 7) % 16);
  });
}

export default function MusicPanel() {
  const { projectId } = useProjectContext();
  const { data: music } = useMusic(projectId);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music size={16} className="text-[var(--accent-green)]" />
          <h3 className="text-sm font-semibold">Soundtrack</h3>
          <span className="text-xs text-[var(--text-muted)]">
            {music.length} tracks from Artlist
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md px-2 py-1 text-[var(--text-secondary)] focus:outline-none">
            <option>All Moods</option>
            <option>Dark / Suspenseful</option>
            <option>Tense / Building</option>
            <option>Mysterious</option>
            <option>Urgent</option>
          </select>
          <select className="text-xs bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md px-2 py-1 text-[var(--text-secondary)] focus:outline-none">
            <option>All Genres</option>
            <option>Cinematic</option>
            <option>Documentary</option>
            <option>Electronic</option>
          </select>
        </div>
      </div>

      {/* Provider note */}
      <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--accent-purple)]/5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--accent-purple)]/10 text-[var(--accent-purple)] font-medium">
            Artlist
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">
            Project-level soundtrack search · All tracks included in subscription
          </span>
        </div>
      </div>

      {/* Music List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {music.map((track) => (
          <MusicCard key={track.id} track={track} />
        ))}
      </div>
    </div>
  );
}

function MusicCard({ track }: { track: MusicAsset }) {
  const waveformHeights = getWaveHeights(track.external_asset_id || track.id);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--border-light)] transition-colors group p-4">
      <div className="flex items-start gap-3">
        {/* Play button */}
        <button className="w-10 h-10 shrink-0 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center hover:bg-[var(--accent-green)]/20 transition-colors group-hover:bg-[var(--accent-green)]/10">
          <Play size={16} className="text-[var(--accent-green)] ml-0.5" />
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">
              {track.title}
            </h4>
            <div className="flex items-center gap-1 shrink-0">
              <Heart size={10} className="text-[var(--text-muted)]" />
              <span className="text-xs font-mono text-[var(--accent-green)]">
                {track.match_score}%
              </span>
            </div>
          </div>

          <span className="text-xs text-[var(--accent-blue)]">{track.artist}</span>

          {/* Metadata row */}
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1">
              <Clock size={10} className="text-[var(--text-muted)]" />
              <span className="text-[10px] text-[var(--text-muted)]">
                {formatMusicDuration(track.duration_ms)}
              </span>
            </div>
            {track.bpm && (
              <div className="flex items-center gap-1">
                <Waves size={10} className="text-[var(--text-muted)]" />
                <span className="text-[10px] text-[var(--text-muted)]">
                  {track.bpm} BPM
                </span>
              </div>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)]">
              {track.mood}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)]">
              {track.genre}
            </span>
          </div>

          {/* Waveform placeholder */}
          <div className="mt-2 h-6 rounded bg-[var(--bg-tertiary)] flex items-center px-2 gap-px">
            {waveformHeights.map((height, i) => (
              <div
                key={i}
                className="w-1 rounded-full bg-[var(--accent-green)]/30"
                style={{ height: `${height}px` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 ml-13">
        <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent-green)]/10 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/20 transition-colors">
          <Download size={12} />
          Add to Timeline
        </button>
        <span className="text-[10px] text-[var(--accent-green)]">{track.license_type} · Included</span>
      </div>
    </div>
  );
}
