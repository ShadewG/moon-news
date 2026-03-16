import { and, eq, desc } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  clipLibrary,
  footageAssets,
  footageQuotes,
  projects,
  researchSources,
  scriptLines,
  visualRecommendations,
} from "@/server/db/schema";
import ReportClient from "./report-client";

type Props = { params: Promise<{ projectId: string }> };

export async function generateMetadata({ params }: Props) {
  const { projectId } = await params;
  const db = getDb();
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  return { title: p ? `${p.title} — Report` : "Report" };
}

export default async function ReportPage({ params }: Props) {
  const { projectId } = await params;
  const db = getDb();

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    return <div className="h-screen bg-[#09090b] flex items-center justify-center text-[#52525b]">Project not found</div>;
  }

  const lines = await db.select().from(scriptLines).where(eq(scriptLines.projectId, projectId)).orderBy(scriptLines.lineIndex);

  const [allAssets, allQuotes, allSources, allRecs] = await Promise.all([
    db.select({ footage_assets: footageAssets, script_lines: scriptLines, clipLibraryId: clipLibrary.id })
      .from(footageAssets)
      .innerJoin(scriptLines, eq(scriptLines.id, footageAssets.scriptLineId))
      .leftJoin(clipLibrary, and(eq(clipLibrary.provider, footageAssets.provider), eq(clipLibrary.externalId, footageAssets.externalAssetId)))
      .where(eq(scriptLines.projectId, projectId))
      .orderBy(desc(footageAssets.matchScore)),
    db.select().from(footageQuotes).innerJoin(scriptLines, eq(scriptLines.id, footageQuotes.scriptLineId)).where(eq(scriptLines.projectId, projectId)).orderBy(desc(footageQuotes.relevanceScore)),
    db.select().from(researchSources).innerJoin(scriptLines, eq(scriptLines.id, researchSources.scriptLineId)).where(eq(scriptLines.projectId, projectId)),
    db.select().from(visualRecommendations).where(eq(visualRecommendations.projectId, projectId)),
  ]);

  // Serialize data for the client component
  const data = {
    project: { id: project.id, title: project.title },
    lines: lines.map((l) => ({
      id: l.id,
      lineKey: l.lineKey,
      lineIndex: l.lineIndex,
      text: l.text,
      lineType: l.lineType,
      category: l.lineContentCategory,
    })),
    assets: allAssets.map((a) => ({
      ...a.footage_assets,
      lineKey: a.script_lines.lineKey,
      clipLibraryId: a.clipLibraryId,
    })),
    quotes: allQuotes.map((q) => ({
      ...q.footage_quotes,
      lineKey: q.script_lines.lineKey,
    })),
    sources: allSources.map((s) => ({
      ...s.research_sources,
      lineKey: s.script_lines.lineKey,
    })),
    recs: allRecs,
  };

  return <ReportClient data={data as Parameters<typeof ReportClient>[0]["data"]} />;
}
