"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useProjectWithLines } from "./hooks";
import type { ScriptLine, ProjectStats } from "./sample-data";
import type { ApiProject } from "./api";

interface ProjectContextValue {
  // Project
  projectId: string | null;
  project: ApiProject | null;
  lines: ScriptLine[];
  stats: ProjectStats;
  isLive: boolean; // true = data from API, false = sample data fallback

  // Selection
  selectedLineId: string;
  setSelectedLineId: (id: string) => void;
  selectedLine: ScriptLine | undefined;

  // Refresh
  refetchProject: () => void;
  refetchStats: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjectContext must be used within ProjectProvider");
  return ctx;
}

interface ProjectProviderProps {
  projectId: string | null;
  children: ReactNode;
}

export function ProjectProvider({ projectId, children }: ProjectProviderProps) {
  const [selectedLineId, setSelectedLineId] = useState<string>("");
  const { data: projectData, isLive, refetch: refetchProject } = useProjectWithLines(projectId);

  const lines = projectData.lines;
  const stats = useMemo<ProjectStats>(() => {
    const researchComplete = lines.filter((line) => line.research_status === "complete").length;
    const researchRunning = lines.filter(
      (line) => line.research_status === "queued" || line.research_status === "running"
    ).length;
    const footageComplete = lines.filter((line) => line.footage_status === "complete").length;
    const imagesGenerated = lines.filter((line) => line.image_status === "complete").length;
    const videosGenerated = lines.filter((line) => line.video_status === "complete").length;
    const totalDurationMs = lines.reduce((sum, line) => sum + line.duration_ms, 0);
    const estimatedCostValue =
      researchComplete * 0.02 +
      researchRunning * 0.01 +
      imagesGenerated * 0.04 +
      videosGenerated * 0.2;

    return {
      totalLines: lines.length,
      researchComplete,
      researchRunning,
      footageComplete,
      imagesGenerated,
      videosGenerated,
      transcriptsComplete: 0,
      musicSelected: 0,
      totalDurationMs,
      estimatedCost: `$${estimatedCostValue.toFixed(2)}`,
    };
  }, [lines]);

  // Auto-select first line if none selected or selection invalid
  const effectiveSelectedId =
    selectedLineId && lines.some((l) => l.id === selectedLineId)
      ? selectedLineId
      : lines[0]?.id ?? "";

  const selectedLine = lines.find((l) => l.id === effectiveSelectedId);

  const handleSetSelectedLineId = useCallback((id: string) => {
    setSelectedLineId(id);
  }, []);

  return (
    <ProjectContext.Provider
      value={{
        projectId,
        project: projectData.project,
        lines,
        stats,
        isLive,
        selectedLineId: effectiveSelectedId,
        setSelectedLineId: handleSetSelectedLineId,
        selectedLine,
        refetchProject,
        refetchStats: refetchProject,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
