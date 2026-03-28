import { listAllStudioGenerations, listAllStudioResearch, listAllStudioRuns } from "@/server/services/studio";
import StudioClient from "./studio-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio — Moon News" };

export default async function StudioPage() {
  const [runs, researches, generations] = await Promise.all([
    listAllStudioRuns(),
    listAllStudioResearch(),
    listAllStudioGenerations(),
  ]);
  return <StudioClient runs={runs} researches={researches} generations={generations} />;
}
