import Link from "next/link";
import { notFound } from "next/navigation";

import { getScriptAgentRun } from "@/server/services/script-agent";
import ScriptAgentDetail from "./detail-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function ScriptAgentRunPage(props: PageProps) {
  const { runId } = await props.params;
  const run = await getScriptAgentRun(runId);

  if (!run) {
    notFound();
  }

  return <ScriptAgentDetail run={run} />;
}
