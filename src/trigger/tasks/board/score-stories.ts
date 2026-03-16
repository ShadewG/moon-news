import { schedules } from "@trigger.dev/sdk/v3";

import { runBoardScoringCycle } from "@/server/services/board";

export const scoreBoardStoriesTask = schedules.task({
  id: "score-board-stories",
  cron: {
    pattern: "12,42 * * * *",
    timezone: "America/New_York",
    environments: ["PRODUCTION"],
  },
  run: async () => {
    const result = await runBoardScoringCycle();

    return {
      status: "complete",
      ...result,
    };
  },
});
