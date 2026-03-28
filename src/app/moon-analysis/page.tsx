import { listRecentMoonAnalysisRuns } from "@/server/services/moon-analysis";

import MoonAnalysisClient from "./moon-analysis-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Moon Analysis Agent" };

export default async function MoonAnalysisPage() {
  const runs = await listRecentMoonAnalysisRuns(20);
  return <MoonAnalysisClient initialRuns={runs} />;
}
