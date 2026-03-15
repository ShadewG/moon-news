import { task } from "@trigger.dev/sdk/v3";

import { searchGetty } from "@/server/providers/getty";

export const searchGettyTask = task({
  id: "search-getty",
  run: async (payload: {
    keywords: string[];
    temporalContext: string | null;
    maxResults?: number;
  }) => {
    return searchGetty(payload);
  },
});
