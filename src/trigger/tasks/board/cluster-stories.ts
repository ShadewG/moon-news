import { schedules } from "@trigger.dev/sdk/v3";

import { runBoardClusteringCycle } from "@/server/services/board";

export const clusterBoardStoriesTask = schedules.task({
  id: "cluster-board-stories",
  cron: {
    pattern: "11,26,41,56 * * * *",
    timezone: "America/New_York",
    environments: ["PRODUCTION"],
  },
  run: async () => {
    const result = await runBoardClusteringCycle();

    return {
      status: "complete",
      ...result,
    };
  },
});
