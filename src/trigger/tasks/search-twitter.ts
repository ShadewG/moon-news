import { task } from "@trigger.dev/sdk/v3";

import { searchTwitterVideos } from "@/server/providers/twitter";

export const searchTwitterTask = task({
  id: "search-twitter",
  run: async (payload: {
    keywords: string[];
    temporalContext: string | null;
    maxResults?: number;
  }) => {
    return searchTwitterVideos(payload);
  },
});
