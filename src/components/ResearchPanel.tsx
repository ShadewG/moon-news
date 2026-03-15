"use client";

import { useEffect } from "react";
import {
  ExternalLink,
  BookOpen,
  FileText,
  Video,
  GraduationCap,
  BookMarked,
  ThumbsUp,
  Copy,
  RotateCcw,
  Star,
  CheckCircle2,
  Loader2,
  Zap,
  Globe,
  Brain,
} from "lucide-react";
import { useProjectContext } from "@/lib/project-context";
import { useResearch, useTriggerResearch } from "@/lib/hooks";
import { formatTimestamp, type ResearchSource } from "@/lib/sample-data";

const typeIcons = {
  article: FileText,
  document: BookOpen,
  book: BookMarked,
  video: Video,
  academic: GraduationCap,
  unknown: FileText,
};

const typeColors: Record<string, string> = {
  article: "text-[var(--accent-blue)]",
  document: "text-[var(--accent-green)]",
  book: "text-[var(--accent-purple)]",
  video: "text-[var(--accent-red)]",
  academic: "text-[var(--accent-yellow)]",
  unknown: "text-[var(--text-muted)]",
};

export default function ResearchPanel() {
  const { projectId, selectedLineId, selectedLine, refetchProject } = useProjectContext();
  const { data: research, loading, refetch } = useResearch(
    projectId,
    selectedLineId,
    selectedLine?.line_key ?? null
  );
  const { trigger, triggering } = useTriggerResearch(projectId);
  const researchStatus = research?.run.status ?? selectedLine?.research_status ?? "pending";
  const isResearchRunning = researchStatus === "queued" || researchStatus === "running";

  useEffect(() => {
    if (!isResearchRunning) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      refetch();
      refetchProject();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isResearchRunning, refetch, refetchProject]);

  const handleStartResearch = async () => {
    if (!projectId || !selectedLineId) return;
    await trigger(selectedLineId);
    refetch();
    refetchProject();
  };

  const parallelStatus =
    research?.run.status === "complete"
      ? "complete"
      : research?.run.status === "queued" || research?.run.status === "running"
        ? "running"
        : research?.run.status === "failed"
          ? "partial"
          : "pending";
  const firecrawlStatus = research?.sources.some((source) => source.extracted_text_path)
    ? "complete"
    : research?.sources.length
      ? "partial"
      : parallelStatus === "running"
        ? "running"
        : "pending";
  const openAiStatus = research?.summary
    ? "complete"
    : firecrawlStatus === "running"
      ? "running"
      : "pending";

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Selected Line Context */}
      {selectedLine && (
        <div className="p-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {formatTimestamp(selectedLine.timestamp_start_ms)}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)] capitalize">
              {selectedLine.line_type}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              researchStatus === "complete"
                ? "bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
                : researchStatus === "queued" || researchStatus === "running"
                  ? "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]"
                  : researchStatus === "failed"
                    ? "bg-[var(--accent-red)]/10 text-[var(--accent-red)]"
                    : "bg-[var(--bg-hover)] text-[var(--text-muted)]"
            }`}>
              Research: {researchStatus}
            </span>
          </div>
          <p className="text-sm text-[var(--text-primary)] leading-relaxed">{selectedLine.text}</p>
        </div>
      )}

      {research ? (
        <>
          {/* Pipeline indicator */}
          <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center gap-4">
            <PipelineStep icon={Globe} label="Parallel" status={parallelStatus} />
            <PipelineArrow />
            <PipelineStep icon={Zap} label="Firecrawl" status={firecrawlStatus} />
            <PipelineArrow />
            <PipelineStep icon={Brain} label="OpenAI" status={openAiStatus} />
          </div>

          {/* Summary */}
          {research.summary && (
            <div className="mx-4 mt-4 p-3 rounded-xl border border-[var(--accent-blue)]/20 bg-[var(--accent-blue)]/5">
              <div className="flex items-center gap-2 mb-2">
                <Brain size={12} className="text-[var(--accent-blue)]" />
                <span className="text-xs font-semibold text-[var(--accent-blue)]">AI Summary</span>
                <span className="text-[10px] text-[var(--text-muted)] ml-auto">
                  {research.summary.model} · {research.summary.confidence_score}% confidence
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{research.summary.summary}</p>
            </div>
          )}

          {/* Sources header */}
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-[var(--accent-blue)]" />
              <h3 className="text-sm font-semibold">Sources</h3>
              <span className="text-xs text-[var(--text-muted)]">{research.sources.length} found</span>
            </div>
            <button
              onClick={handleStartResearch}
              disabled={triggering || !selectedLineId}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
            >
              <RotateCcw size={12} className={triggering ? "animate-spin" : ""} />
              Re-research
            </button>
          </div>

          {/* Source cards */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {research.sources.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center h-full text-center px-8">
          <div className="w-12 h-12 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
            {loading || triggering ? (
              <Loader2 size={20} className="text-[var(--accent-blue)] animate-spin" />
            ) : (
              <BookOpen size={20} className="text-[var(--text-muted)]" />
            )}
          </div>
          <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-1">
            {!selectedLine
              ? "Select a Line"
              : loading
                ? "Loading..."
                : triggering
                  ? "Starting Research..."
                  : "No Research Yet"}
          </h4>
          <p className="text-xs text-[var(--text-muted)] mb-4 max-w-[280px]">
            {!selectedLine
              ? "Choose a script line to run Parallel research, Firecrawl extraction, and OpenAI synthesis."
              : "Start deep research via Parallel + Firecrawl + OpenAI for this script line."}
          </p>
          {!loading && !triggering && selectedLine && (
            <button
              onClick={handleStartResearch}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue-hover)] transition-colors"
            >
              <BookOpen size={14} />
              Start Deep Research
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PipelineStep({ icon: Icon, label, status }: {
  icon: typeof Globe;
  label: string;
  status: "complete" | "partial" | "pending" | "running";
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`p-1 rounded-md ${
        status === "complete" ? "bg-[var(--accent-green)]/10" :
        status === "partial" ? "bg-[var(--accent-yellow)]/10" :
        status === "running" ? "bg-[var(--accent-blue)]/10" :
        "bg-[var(--bg-hover)]"
      }`}>
        <Icon size={11} className={
          status === "complete" ? "text-[var(--accent-green)]" :
          status === "partial" ? "text-[var(--accent-yellow)]" :
          status === "running" ? "text-[var(--accent-blue)]" :
          "text-[var(--text-muted)]"
        } />
      </div>
      <span className="text-[10px] font-medium text-[var(--text-secondary)]">{label}</span>
      {status === "complete" && <CheckCircle2 size={9} className="text-[var(--accent-green)]" />}
      {status === "running" && <Loader2 size={9} className="text-[var(--accent-blue)] animate-spin" />}
    </div>
  );
}

function PipelineArrow() {
  return <div className="w-4 h-px bg-[var(--border-light)]" />;
}

function SourceCard({ source }: { source: ResearchSource }) {
  const TypeIcon = typeIcons[source.source_type] ?? typeIcons.unknown;
  const color = typeColors[source.source_type] ?? typeColors.unknown;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--border-light)] transition-colors group">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-start gap-2 min-w-0">
            <div className={`mt-0.5 p-1 rounded-md bg-[var(--bg-tertiary)] ${color}`}><TypeIcon size={12} /></div>
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-[var(--text-primary)] leading-snug">{source.title}</h4>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-[var(--accent-blue)]">{source.source_name}</span>
                <span className="text-xs text-[var(--text-muted)]">{source.published_at}</span>
                {source.extracted_text_path && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--accent-green)]/10 text-[var(--accent-green)]">Firecrawl extracted</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Star size={10} className="text-[var(--accent-yellow)]" />
            <span className={`text-xs font-mono font-medium ${
              source.relevance_score >= 95 ? "text-[var(--accent-green)]" :
              source.relevance_score >= 85 ? "text-[var(--accent-blue)]" :
              "text-[var(--text-secondary)]"
            }`}>{source.relevance_score}%</span>
          </div>
        </div>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-2">{source.snippet}</p>
        {source.citation_json && (
          <div className="mt-2 px-2 py-1 rounded-md bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-muted)] font-mono">
            {source.citation_json.apa}
          </div>
        )}
        <div className="flex items-center gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"><ExternalLink size={10} />Open Source</button>
          <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"><Copy size={10} />Cite</button>
          <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"><ThumbsUp size={10} />Use in Script</button>
        </div>
      </div>
    </div>
  );
}
