import { task } from "@trigger.dev/sdk/v3";

import { runVisualSearchTask } from "@/server/services/visual-search";

export const visualSearchTask = task({
  id: "visual-search",
  run: async (payload: {
    projectId: string;
    scriptLineId: string;
    lineText: string;
    scriptContext?: string;
    category: string;
    searchKeywords: string[];
    temporalContext: string | null;
  }) => {
    const result = await runVisualSearchTask(payload);
    return { scriptLineId: payload.scriptLineId, ...result };
  },
});
