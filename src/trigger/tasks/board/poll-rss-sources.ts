import { schedules } from "@trigger.dev/sdk/v3";

import { runBoardSourcePollCycle } from "@/server/services/board";

export const pollBoardRssSourcesTask = schedules.task({
  id: "poll-board-rss-sources",
  cron: {
    pattern: "7,22,37,52 * * * *",
    timezone: "America/New_York",
    environments: ["PRODUCTION"],
  },
  run: async () => {
    const result = await runBoardSourcePollCycle();

    return {
      status: "complete",
      ...result,
    };
  },
});
