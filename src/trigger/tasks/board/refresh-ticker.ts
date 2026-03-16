import { schedules } from "@trigger.dev/sdk/v3";

import { runBoardTickerRefreshCycle } from "@/server/services/board";

export const refreshBoardTickerTask = schedules.task({
  id: "refresh-board-ticker",
  cron: {
    pattern: "13,43 * * * *",
    timezone: "America/New_York",
    environments: ["PRODUCTION"],
  },
  run: async () => {
    const result = await runBoardTickerRefreshCycle();

    return {
      status: "complete",
      ...result,
    };
  },
});
