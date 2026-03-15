"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useProjectWithLines, useProjectStats } from "./hooks";
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
  const { data: stats, refetch: refetchStats } = useProjectStats(projectId);

  const lines = projectData.lines;

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
        refetchStats,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
