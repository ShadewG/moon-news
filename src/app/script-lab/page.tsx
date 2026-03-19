import { listRecentScriptLabRuns } from "@/server/services/script-lab";
import ScriptLabClient from "./script-lab-client";

export const dynamic = "force-dynamic";

export default async function ScriptLabPage() {
  const recentRuns = await listRecentScriptLabRuns(8);
  return <ScriptLabClient recentRuns={recentRuns} />;
}
