"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "./api";
import * as sample from "./sample-data";
import type {
  ScriptLine,
  ResearchData,
  FootageAsset,
  MusicAsset,
  TranscriptJob,
  Transcript,
  ImageGenerationJob,
  VideoGenerationJob,
  TimelineItem,
  ProjectStats,
} from "./sample-data";

// ─── Generic fetch hook with sample-data fallback ───

function useFetch<T>(
  fetcher: () => Promise<T>,
  fallback: T,
  deps: unknown[]
): {
  data: T;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  isLive: boolean; // true if data came from API, false if fallback
} {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const mountedRef = useRef(true);

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
        setIsLive(true);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Unknown error");
        setData(fallback);
        setIsLive(false);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    doFetch();
    return () => { mountedRef.current = false; };
  }, [doFetch]);

  return { data, loading, error, refetch: doFetch, isLive };
}

// ─── Project + Lines ───

export function useProjectWithLines(projectId: string | null) {
  return useFetch(
    async () => {
      if (!projectId) throw new Error("No project ID");
      const res = await api.getProject(projectId);
      return { project: res.project, lines: res.lines };
    },
    {
      project: null as api.ApiProject | null,
      lines: sample.sampleScript,
    },
    [projectId]
  );
}

export function useProjects() {
  return useFetch(
    async () => {
      const res = await api.listProjects();
      return res.projects;
    },
    [] as api.ApiProject[],
    []
  );
}

// ─── Research ───

export function useResearch(projectId: string | null, lineId: string | null) {
  return useFetch(
    async (): Promise<ResearchData | null> => {
      if (!projectId || !lineId) return null;
      return api.getResearch(projectId, lineId);
    },
    lineId ? (sample.sampleResearch[lineId] ?? null) : null,
    [projectId, lineId]
  );
}

export function useTriggerResearch(projectId: string | null) {
  const [triggering, setTriggering] = useState(false);

  const trigger = useCallback(async (lineId: string) => {
    if (!projectId) return null;
    setTriggering(true);
    try {
      return await api.triggerResearch(projectId, lineId);
    } finally {
      setTriggering(false);
    }
  }, [projectId]);

  return { trigger, triggering };
}

// ─── Footage ───

export function useFootage(projectId: string | null, lineId: string | null) {
  return useFetch(
    async (): Promise<FootageAsset[]> => {
      if (!projectId || !lineId) return [];
      return api.getFootage(projectId, lineId);
    },
    lineId ? (sample.sampleFootage[lineId] ?? []) : [],
    [projectId, lineId]
  );
}

// ─── Music ───

export function useMusic(projectId: string | null) {
  return useFetch(
    async (): Promise<MusicAsset[]> => {
      if (!projectId) return [];
      return api.getMusic(projectId);
    },
    sample.sampleMusic["project"] ?? [],
    [projectId]
  );
}

// ─── Transcripts ───

export function useTranscript(projectId: string | null, lineId: string | null) {
  return useFetch(
    async (): Promise<{ job: TranscriptJob | null; transcript: Transcript | null }> => {
      if (!projectId || !lineId) return { job: null, transcript: null };
      return api.getTranscript(projectId, lineId);
    },
    lineId && sample.sampleTranscripts[lineId]
      ? sample.sampleTranscripts[lineId]
      : { job: null, transcript: null },
    [projectId, lineId]
  );
}

// ─── Image Jobs ───

export function useImageJobs(projectId: string | null, lineId: string | null) {
  return useFetch(
    async (): Promise<ImageGenerationJob[]> => {
      if (!projectId || !lineId) return [];
      return api.getImageJobs(projectId, lineId);
    },
    lineId ? (sample.sampleImageJobs[lineId] ?? []) : [],
    [projectId, lineId]
  );
}

// ─── Video Jobs ───

export function useVideoJobs(projectId: string | null, lineId: string | null) {
  return useFetch(
    async (): Promise<VideoGenerationJob[]> => {
      if (!projectId || !lineId) return [];
      return api.getVideoJobs(projectId, lineId);
    },
    lineId ? (sample.sampleVideoJobs[lineId] ?? []) : [],
    [projectId, lineId]
  );
}

// ─── Timeline ───

export function useTimeline(projectId: string | null) {
  return useFetch(
    async (): Promise<TimelineItem[]> => {
      if (!projectId) return [];
      return api.getTimeline(projectId);
    },
    sample.sampleTimeline,
    [projectId]
  );
}

// ─── Stats ───

export function useProjectStats(projectId: string | null) {
  return useFetch(
    async (): Promise<ProjectStats> => {
      if (!projectId) throw new Error("No project ID");
      return api.getProjectStats(projectId);
    },
    sample.projectStats,
    [projectId]
  );
}
