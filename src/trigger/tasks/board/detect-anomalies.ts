import { schedules } from "@trigger.dev/sdk/v3";

import { runBoardAnomalyDetectionCycle } from "@/server/services/board";

export const detectBoardAnomaliesTask = schedules.task({
  id: "detect-board-anomalies",
  cron: {
    pattern: "13,28,43,58 * * * *",
    timezone: "America/New_York",
    environments: ["PRODUCTION"],
  },
  run: async () => {
    const result = await runBoardAnomalyDetectionCycle();

    return {
      status: "complete",
      ...result,
    };
  },
});
