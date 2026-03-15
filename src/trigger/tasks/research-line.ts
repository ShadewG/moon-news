import { task } from "@trigger.dev/sdk/v3";

import { runResearchLineTask } from "@/server/services/research";

export const researchLineTask = task({
  id: "research-line",
  run: async (payload: { researchRunId: string }) => {
    await runResearchLineTask(payload);

    return {
      researchRunId: payload.researchRunId,
      status: "complete",
    };
  },
});
