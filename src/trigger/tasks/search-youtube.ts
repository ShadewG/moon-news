import { task } from "@trigger.dev/sdk/v3";

import { searchYouTube } from "@/server/providers/youtube";

export const searchYouTubeTask = task({
  id: "search-youtube",
  run: async (payload: {
    keywords: string[];
    temporalContext: string | null;
    maxResults?: number;
  }) => {
    return searchYouTube(payload);
  },
});
