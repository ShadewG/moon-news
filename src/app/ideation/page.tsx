import { ideationServerFetch } from "@/lib/ideation-api";
import type { DashboardSummary, TrendClusterRead } from "@/lib/ideation-types";

import IdeationDashboard from "./ideation-dashboard";

export const dynamic = "force-dynamic";

export default async function IdeationPage() {
  const [summary, trends] = await Promise.all([
    ideationServerFetch<DashboardSummary>("/dashboard/summary?window=30d"),
    ideationServerFetch<TrendClusterRead[]>("/dashboard/trends?window=30d&limit=8&exclude_news_sources=true"),
  ]);

  return (
    <IdeationDashboard
      initialSummary={summary}
      initialTrends={trends}
    />
  );
}
