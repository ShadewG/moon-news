import { listAllStudioRuns } from "@/server/services/studio";
import StudioClient from "../studio-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Generate — Moon News" };

export default async function ScriptLabPage() {
  const runs = await listAllStudioRuns();
  return (
    <StudioClient
      runs={runs}
      initialView="generate"
      initialGenerateMode="agent"
      generateOnly
      headerLabel="Moon News Generate"
      generateTitle="Generate"
    />
  );
}
