import { NextResponse } from "next/server";

import { listMoonCorpusClusters } from "@/server/services/moon-corpus";

export async function GET() {
  const clusters = await listMoonCorpusClusters();

  return NextResponse.json({
    clusters: clusters.map((cluster) => ({
      id: cluster.id,
      clusterKey: cluster.clusterKey,
      label: cluster.label,
      coverageMode: cluster.coverageMode,
      keywords: Array.isArray(cluster.keywordsJson) ? cluster.keywordsJson : [],
      entityKeys: Array.isArray(cluster.entityKeysJson) ? cluster.entityKeysJson : [],
      exampleClipIds: Array.isArray(cluster.exampleClipIdsJson) ? cluster.exampleClipIdsJson : [],
      profileVersion: cluster.profileVersion,
      analyzedAt: cluster.analyzedAt?.toISOString() ?? null,
    })),
  });
}
