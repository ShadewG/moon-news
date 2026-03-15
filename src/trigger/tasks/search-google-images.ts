import { task } from "@trigger.dev/sdk/v3";

import { searchGoogleImages } from "@/server/providers/google-images";

export const searchGoogleImagesTask = task({
  id: "search-google-images",
  run: async (payload: {
    keywords: string[];
    temporalContext: string | null;
    maxResults?: number;
  }) => {
    return searchGoogleImages(payload);
  },
});
