"use client";

import {
  Mic,
  Loader2,
  CheckCircle2,
  Clock,
  Upload,
  User,
  Play,
} from "lucide-react";
import {
  sampleTranscripts,
  sampleScript,
  formatTimestamp,
  type Transcript,
  type TranscriptJob,
} from "@/lib/sample-data";

interface TranscriptPanelProps {
  selectedLine: string;
}

export default function TranscriptPanel({ selectedLine }: TranscriptPanelProps) {
  const data = sampleTranscripts[selectedLine];
  const line = sampleScript.find((l) => l.id === selectedLine);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Line context */}
      {line && (
        <div className="p-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {formatTimestamp(line.timestamp_start_ms)}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)] capitalize">
              {line.line_type}
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
          <Mic size={16} className="text-[var(--accent-yellow)]" />
          <h3 className="text-sm font-semibold">Transcript</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)] font-medium">
            ElevenLabs STT
          </span>
        </div>
        {data?.job && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)]">
              Job: {data.job.id}
            </span>
            <JobStatusBadge status={data.job.status} />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {data?.transcript ? (
          <TranscriptView transcript={data.transcript} />
        ) : data?.job?.status === "running" ? (
          <RunningState job={data.job} />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  if (status === "complete") {
    return (
      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--accent-green)]/10 text-[var(--accent-green)]">
        <CheckCircle2 size={9} />
        Complete
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]">
        <Loader2 size={9} className="animate-spin" />
        Transcribing
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--bg-hover)] text-[var(--text-muted)]">
      <Clock size={9} />
      {status}
    </span>
  );
}

function TranscriptView({ transcript }: { transcript: Transcript }) {
  return (
    <div className="space-y-4">
      {/* Metadata */}
      <div className="flex items-center gap-4 p-3 rounded-lg bg-[var(--bg-tertiary)]">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--text-muted)]">Language:</span>
          <span className="text-[10px] font-medium text-[var(--text-secondary)]">{transcript.language_code.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <User size={10} className="text-[var(--text-muted)]" />
          <span className="text-[10px] text-[var(--text-muted)]">
            {transcript.speaker_count} speaker{transcript.speaker_count > 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--text-muted)]">Words:</span>
          <span className="text-[10px] font-medium text-[var(--text-secondary)]">{transcript.words_json.length}+</span>
        </div>
      </div>

      {/* Full text */}
      <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
        <p className="text-sm text-[var(--text-primary)] leading-relaxed">
          {transcript.full_text}
        </p>
      </div>

      {/* Segments with timestamps */}
      <div>
        <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">Timed Segments</h4>
        <div className="space-y-1.5">
          {transcript.segments_json.map((segment, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors group"
            >
              <button className="mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Play size={10} className="text-[var(--accent-blue)]" />
              </button>
              <span className="text-[10px] font-mono text-[var(--accent-blue)] mt-0.5 min-w-[60px]">
                {formatTimestamp(segment.start_ms)} → {formatTimestamp(segment.end_ms)}
              </span>
              {segment.speaker && (
                <span className="text-[10px] font-medium text-[var(--accent-purple)] mt-0.5 min-w-[80px]">
                  {segment.speaker}
                </span>
              )}
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed flex-1">
                {segment.text}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Word-level timestamps preview */}
      <div>
        <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">Word Timing (preview)</h4>
        <div className="flex flex-wrap gap-1 p-3 rounded-lg bg-[var(--bg-tertiary)]">
          {transcript.words_json.map((w, i) => (
            <span
              key={i}
              className="text-[10px] px-1 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--accent-blue)]/10 hover:text-[var(--accent-blue)] cursor-pointer transition-colors"
              title={`${w.start_ms}ms → ${w.end_ms}ms`}
            >
              {w.word}
            </span>
          ))}
          <span className="text-[10px] text-[var(--text-muted)]">...</span>
        </div>
      </div>
    </div>
  );
}

function RunningState({ job }: { job: TranscriptJob }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <Loader2 size={24} className="text-[var(--accent-yellow)] animate-spin mb-4" />
      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-1">Transcribing...</h4>
      <p className="text-xs text-[var(--text-muted)] mb-2">
        ElevenLabs is processing the audio file.
      </p>
      <span className="text-[10px] font-mono text-[var(--text-muted)]">
        Input: {job.input_media_path.split("/").pop()}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-12 h-12 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
        <Mic size={20} className="text-[var(--text-muted)]" />
      </div>
      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-1">No Transcript</h4>
      <p className="text-xs text-[var(--text-muted)] mb-4 max-w-[280px]">
        Upload source media to transcribe with ElevenLabs STT. Get word-level timestamps and speaker diarization.
      </p>
      <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent-yellow)] text-black hover:opacity-90 transition-opacity">
        <Upload size={14} />
        Upload & Transcribe
      </button>
    </div>
  );
}
