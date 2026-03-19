import { task } from "@trigger.dev/sdk/v3";

import {
  rebuildMoonCorpusAnalysis,
  scoreBoardStoriesWithMoonCorpus,
} from "@/server/services/moon-corpus";

export const analyzeMoonCorpusTask = task({
  id: "analyze-moon-corpus",
  run: async () => {
    const corpus = await rebuildMoonCorpusAnalysis();
    const stories = await scoreBoardStoriesWithMoonCorpus();

    return {
      corpus,
      stories,
    };
  },
});
