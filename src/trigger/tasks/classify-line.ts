import { task } from "@trigger.dev/sdk/v3";

import { runClassifyLineTask } from "@/server/services/investigation";

export const classifyLineTask = task({
  id: "classify-line",
  run: async (payload: { scriptLineId: string; projectId: string }) => {
    const classification = await runClassifyLineTask(payload);
    return { scriptLineId: payload.scriptLineId, classification };
  },
});
