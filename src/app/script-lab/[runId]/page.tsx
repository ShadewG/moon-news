import { notFound } from "next/navigation";

import { getScriptLabRun } from "@/server/services/script-lab";
import ScriptLabDetail from "./detail-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function SavedScriptLabRunPage(props: PageProps) {
  const { runId } = await props.params;
  const run = await getScriptLabRun(runId);

  if (!run) {
    notFound();
  }

  return <ScriptLabDetail run={run} />;
}
