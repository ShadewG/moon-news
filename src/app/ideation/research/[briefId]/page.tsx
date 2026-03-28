import { ideationServerFetch } from "@/lib/ideation-api";
import type { ResearchBriefRead } from "@/lib/ideation-types";

import BriefDetailClient from "./brief-detail-client";

export const dynamic = "force-dynamic";

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<{ briefId: string }>;
}) {
  const { briefId } = await params;
  const brief = await ideationServerFetch<ResearchBriefRead>(`/research/${briefId}`);

  if (!brief) {
    return (
      <div>
        <div className="ib-page-header">
          <h2>Brief Not Found</h2>
        </div>
        <div className="ib-panel" style={{ padding: 20, textAlign: "center" }}>
          <span className="ib-meta">
            Research brief #{briefId} could not be loaded.
          </span>
        </div>
      </div>
    );
  }

  return <BriefDetailClient initialBrief={brief} />;
}
