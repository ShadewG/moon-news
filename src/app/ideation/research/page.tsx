import { ideationServerFetch } from "@/lib/ideation-api";
import type {
  ResearchBriefSummary,
  ExistingOutlineRead,
  GenerationRunRead,
} from "@/lib/ideation-types";

import ResearchClient from "./research-client";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const [briefs, outlines, reports, generations] = await Promise.all([
    ideationServerFetch<ResearchBriefSummary[]>("/research"),
    ideationServerFetch<ExistingOutlineRead[]>("/research/existing-outlines"),
    ideationServerFetch<Record<string, unknown>[]>("/research/script-reports"),
    ideationServerFetch<GenerationRunRead[]>("/research/generations"),
  ]);

  return (
    <ResearchClient
      initialBriefs={briefs ?? []}
      initialOutlines={outlines ?? []}
      initialReports={reports ?? []}
      initialGenerations={generations ?? []}
    />
  );
}
