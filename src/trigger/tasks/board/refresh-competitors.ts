import { schedules } from "@trigger.dev/sdk/v3";

import { runBoardCompetitorRefreshCycle } from "@/server/services/board";

export const refreshBoardCompetitorsTask = schedules.task({
  id: "refresh-board-competitors",
  cron: {
    pattern: "17,47 * * * *",
    timezone: "America/New_York",
    environments: ["PRODUCTION"],
  },
  run: async () => {
    const result = await runBoardCompetitorRefreshCycle();

    return {
      status: "complete",
      ...result,
    };
  },
});
