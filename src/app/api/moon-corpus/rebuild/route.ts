import { NextResponse } from "next/server";

import {
  rebuildMoonCorpusAnalysis,
  scoreBoardStoriesWithMoonCorpus,
} from "@/server/services/moon-corpus";

export async function POST() {
  const corpus = await rebuildMoonCorpusAnalysis();
  const stories = await scoreBoardStoriesWithMoonCorpus();

  return NextResponse.json({
    ok: true,
    corpus,
    stories,
  });
}
