import { task } from "@trigger.dev/sdk/v3";

import { searchStoryblocks } from "@/server/providers/storyblocks";

export const searchStoryblocksTask = task({
  id: "search-storyblocks",
  run: async (payload: {
    keywords: string[];
    temporalContext: string | null;
    maxResults?: number;
  }) => {
    return searchStoryblocks(payload);
  },
});
