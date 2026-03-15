// Typed API client for all backend endpoints.
// Normalizes backend camelCase responses → frontend snake_case types.

import type {
  ScriptLine,
  ResearchData,
  ResearchRun,
  ResearchSource,
  ResearchSummary,
  FootageAsset,
  MusicAsset,
  TranscriptJob,
  Transcript,
  ImageGenerationJob,
  VideoGenerationJob,
  TimelineItem,
  ProjectStats,
  JobStatus,
} from "./sample-data";

const BASE = "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

// ─── Normalizers (backend camelCase → frontend snake_case) ───

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeScriptLine(raw: any): ScriptLine {
  return {
    id: raw.id,
    project_id: raw.projectId ?? raw.project_id,
    script_version_id: raw.scriptVersionId ?? raw.script_version_id,
    line_key: raw.lineKey ?? raw.line_key,
    line_index: raw.lineIndex ?? raw.line_index,
    timestamp_start_ms: raw.timestampStartMs ?? raw.timestamp_start_ms ?? 0,
    duration_ms: raw.durationMs ?? raw.duration_ms ?? 0,
    text: raw.text,
    line_type: raw.lineType ?? raw.line_type ?? "narration",
    research_status: raw.researchStatus ?? raw.research_status ?? "pending",
    footage_status: raw.footageStatus ?? raw.footage_status ?? "pending",
    image_status: raw.imageStatus ?? raw.image_status ?? "pending",
    video_status: raw.videoStatus ?? raw.video_status ?? "pending",
  };
}

function normalizeResearchRun(raw: any): ResearchRun {
  return {
    id: raw.id,
    project_id: raw.projectId ?? raw.project_id,
    script_line_id: raw.scriptLineId ?? raw.script_line_id,
    provider: raw.provider ?? "parallel",
    status: raw.status ?? "pending",
    query: raw.query ?? "",
    parallel_job_id: raw.parallelSearchId ?? raw.parallel_job_id ?? null,
    started_at: raw.startedAt ?? raw.started_at ?? null,
    completed_at: raw.completedAt ?? raw.completed_at ?? null,
    error_message: raw.errorMessage ?? raw.error_message ?? null,
  };
}

function normalizeResearchSource(raw: any): ResearchSource {
  return {
    id: raw.id,
    research_run_id: raw.researchRunId ?? raw.research_run_id,
    script_line_id: raw.scriptLineId ?? raw.script_line_id,
    title: raw.title,
    source_name: raw.sourceName ?? raw.source_name,
    source_url: raw.sourceUrl ?? raw.source_url,
    published_at: raw.publishedAt ?? raw.published_at ?? "",
    snippet: raw.snippet ?? "",
    extracted_text_path: raw.extractedTextPath ?? raw.extracted_text_path ?? null,
    relevance_score: raw.relevanceScore ?? raw.relevance_score ?? 0,
    source_type: raw.sourceType ?? raw.source_type ?? "article",
    citation_json: raw.citationJson ?? raw.citation_json ?? null,
  };
}

function normalizeResearchSummary(raw: any): ResearchSummary {
  return {
    id: raw.id,
    research_run_id: raw.researchRunId ?? raw.research_run_id,
    script_line_id: raw.scriptLineId ?? raw.script_line_id,
    summary: raw.summary,
    confidence_score: raw.confidenceScore ?? raw.confidence_score ?? 0,
    model: raw.model ?? "unknown",
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Projects ───

export interface ApiProject {
  id: string;
  title: string;
  slug: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function listProjects(): Promise<{ projects: ApiProject[] }> {
  return apiFetch("/api/projects");
}

export async function getProject(projectId: string): Promise<{
  project: ApiProject;
  lines: ScriptLine[];
}> {
  const raw = await apiFetch<{ project: ApiProject; lines: unknown[] }>(
    `/api/projects/${projectId}`
  );
  return {
    project: raw.project,
    lines: (raw.lines || []).map(normalizeScriptLine),
  };
}

export async function createProject(input: {
  title: string;
  rawScript?: string;
  lines?: { lineKey: string; lineIndex: number; text: string; lineType: string; timestampStartMs?: number; durationMs?: number }[];
}): Promise<{ project: ApiProject }> {
  return apiFetch("/api/projects", { method: "POST", body: JSON.stringify(input) });
}

export async function bootstrapProject(): Promise<{
  project: ApiProject | null;
  lines: ScriptLine[];
}> {
  const raw = await apiFetch<{ project: ApiProject | null; lines: unknown[] }>(
    "/api/projects/bootstrap",
    {
      method: "POST",
      body: JSON.stringify({}),
    }
  );

  return {
    project: raw.project,
    lines: (raw.lines || []).map(normalizeScriptLine),
  };
}

// ─── Research ───

export async function getResearch(projectId: string, lineId: string): Promise<ResearchData | null> {
  const raw = await apiFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/lines/${lineId}/research`
  );

  if ("research" in raw && raw.research === null) {
    return null;
  }

  const run = raw.run ? normalizeResearchRun(raw.run) : null;
  if (!run) return null;

  const sources = Array.isArray(raw.sources) ? raw.sources.map(normalizeResearchSource) : [];
  const summary = raw.summary ? normalizeResearchSummary(raw.summary) : null;

  return { run, sources, summary };
}

export async function triggerResearch(projectId: string, lineId: string): Promise<{
  runId: string;
  execution: { mode: string; triggerRunId: string | null };
}> {
  return apiFetch(`/api/projects/${projectId}/lines/${lineId}/research`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// ─── Footage ───

export async function getFootage(projectId: string, lineId: string): Promise<FootageAsset[]> {
  const raw = await apiFetch<{ assets: FootageAsset[] }>(
    `/api/projects/${projectId}/lines/${lineId}/footage`
  );
  return raw.assets || [];
}

export async function triggerFootageSearch(projectId: string, lineId: string, providers?: string[]): Promise<{ runId: string }> {
  return apiFetch(`/api/projects/${projectId}/lines/${lineId}/footage-search`, {
    method: "POST",
    body: JSON.stringify({ providers }),
  });
}

// ─── Music ───

export async function getMusic(projectId: string): Promise<MusicAsset[]> {
  const raw = await apiFetch<{ assets: MusicAsset[] }>(`/api/projects/${projectId}/music`);
  return raw.assets || [];
}

// ─── Transcripts ───

export async function getTranscript(projectId: string, lineId: string): Promise<{
  job: TranscriptJob | null;
  transcript: Transcript | null;
}> {
  return apiFetch(`/api/projects/${projectId}/lines/${lineId}/transcript`);
}

export async function triggerTranscribe(projectId: string, lineId: string): Promise<{ jobId: string }> {
  return apiFetch(`/api/projects/${projectId}/lines/${lineId}/transcribe`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// ─── Image Generation ───

export async function getImageJobs(projectId: string, lineId: string): Promise<ImageGenerationJob[]> {
  const raw = await apiFetch<{ jobs: ImageGenerationJob[] }>(
    `/api/projects/${projectId}/lines/${lineId}/images`
  );
  return raw.jobs || [];
}

export async function triggerImageGeneration(projectId: string, lineId: string, input: {
  provider: "openai" | "gemini";
  styleLabel: string;
}): Promise<{ jobId: string }> {
  return apiFetch(`/api/projects/${projectId}/lines/${lineId}/generate-image`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ─── Video Generation ───

export async function getVideoJobs(projectId: string, lineId: string): Promise<VideoGenerationJob[]> {
  const raw = await apiFetch<{ jobs: VideoGenerationJob[] }>(
    `/api/projects/${projectId}/lines/${lineId}/videos`
  );
  return raw.jobs || [];
}

export async function triggerVideoGeneration(projectId: string, lineId: string, input: {
  styleLabel: string;
  sourceImageAssetId?: string;
}): Promise<{ jobId: string }> {
  return apiFetch(`/api/projects/${projectId}/lines/${lineId}/generate-video`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ─── Timeline ───

export async function getTimeline(projectId: string): Promise<TimelineItem[]> {
  const raw = await apiFetch<{ items: TimelineItem[] }>(`/api/projects/${projectId}/timeline`);
  return raw.items || [];
}

// ─── Stats ───

export async function getProjectStats(projectId: string): Promise<ProjectStats> {
  return apiFetch(`/api/projects/${projectId}/stats`);
}

// ─── Job Status ───

export async function getJobStatus(jobId: string): Promise<{
  job: { id: string; status: JobStatus };
}> {
  return apiFetch(`/api/jobs/${jobId}`);
}
