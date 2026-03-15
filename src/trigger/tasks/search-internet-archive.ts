import { task } from "@trigger.dev/sdk/v3";

import { searchInternetArchive } from "@/server/providers/internet-archive";

export const searchInternetArchiveTask = task({
  id: "search-internet-archive",
  run: async (payload: {
    keywords: string[];
    temporalContext: string | null;
    maxResults?: number;
  }) => {
    return searchInternetArchive(payload);
  },
});
