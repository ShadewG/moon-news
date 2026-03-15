import { task } from "@trigger.dev/sdk/v3";

import { runInvestigateLineTask } from "@/server/services/investigation";

export const investigateLineTask = task({
  id: "investigate-line",
  retry: { maxAttempts: 2 },
  run: async (payload: { projectId: string; scriptLineId: string }) => {
    await runInvestigateLineTask(payload);
    return { scriptLineId: payload.scriptLineId, status: "complete" };
  },
});
