import { task } from "@trigger.dev/sdk/v3";

import { runScriptAgentTask } from "@/server/services/script-agent";

export const runScriptAgentTriggerTask = task({
  id: "run-script-agent",
  run: async (payload: { runId: string }) => {
    await runScriptAgentTask(payload);

    return {
      runId: payload.runId,
      status: "complete",
    };
  },
});
