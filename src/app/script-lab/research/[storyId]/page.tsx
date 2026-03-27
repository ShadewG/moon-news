import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { boardStoryAiOutputs, boardStoryCandidates } from "@/server/db/schema";
import ResearchDetailClient from "./research-detail-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ storyId: string }>;
};

export async function generateMetadata(props: PageProps) {
  const { storyId } = await props.params;
  const db = getDb();
  const rows = await db
    .select({ title: boardStoryCandidates.canonicalTitle })
    .from(boardStoryCandidates)
    .where(eq(boardStoryCandidates.id, storyId))
    .limit(1);
  const title = rows[0]?.title ?? "Research";
  return { title: `${title} — Deep Research — Moon News` };
}

export default async function DeepResearchDetailPage(props: PageProps) {
  const { storyId } = await props.params;
  const db = getDb();

  const rows = await db
    .select({
      storyId: boardStoryAiOutputs.storyId,
      title: boardStoryCandidates.canonicalTitle,
      slug: boardStoryCandidates.slug,
      vertical: boardStoryCandidates.vertical,
      storyMeta: boardStoryCandidates.metadataJson,
      content: boardStoryAiOutputs.content,
      outputMeta: boardStoryAiOutputs.metadataJson,
      model: boardStoryAiOutputs.model,
      createdAt: boardStoryAiOutputs.createdAt,
      updatedAt: boardStoryAiOutputs.updatedAt,
    })
    .from(boardStoryAiOutputs)
    .innerJoin(
      boardStoryCandidates,
      eq(boardStoryAiOutputs.storyId, boardStoryCandidates.id)
    )
    .where(
      and(
        eq(boardStoryAiOutputs.storyId, storyId),
        eq(boardStoryAiOutputs.kind, "brief")
      )
    )
    .limit(1);

  if (rows.length === 0) notFound();

  const row = rows[0];
  let research = null;
  try {
    research = JSON.parse(row.content ?? "{}");
  } catch {
    research = {};
  }

  const meta = (row.outputMeta ?? {}) as Record<string, unknown>;

  return (
    <ResearchDetailClient
      storyId={row.storyId}
      title={row.title}
      vertical={row.vertical}
      research={research}
      model={row.model}
      meta={{
        mode: String(meta.mode ?? "quick"),
        searchResultCount: Number(meta.searchResultCount ?? 0),
        extractedCount: Number(meta.extractedCount ?? 0),
        sources: (meta.sources ?? []) as Array<{ title: string; url: string; source?: string }>,
      }}
      createdAt={row.createdAt.toISOString()}
      updatedAt={row.updatedAt.toISOString()}
    />
  );
}
