import { NextResponse } from "next/server";

import {
  runBoardSourcePollCycle,
  runBoardCompetitorRefreshCycle,
  runBoardTickerRefreshCycle,
} from "@/server/services/board";

/**
 * Single cron endpoint that replaces 6 Trigger.dev scheduled tasks.
 * Call this every 15 minutes from Railway cron or setInterval.
 *
 * Replaces:
 * - poll-board-rss-sources (every 15 min) → runBoardSourcePollCycle
 * - cluster-board-stories (every 15 min) → included in poll cycle
 * - detect-board-anomalies (every 15 min) → included in poll cycle
 * - score-board-stories (every 30 min) → included in poll cycle
 * - refresh-board-ticker (every 30 min) → runBoardTickerRefreshCycle
 * - refresh-board-competitors (every 30 min) → runBoardCompetitorRefreshCycle
 */
export async function POST(request: Request) {
  // Optional auth check via secret header
  const authHeader = request.headers.get("x-cron-secret");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  // Run the full poll cycle (poll + rescore + alerts)
  const pollResult = await runBoardSourcePollCycle();

  // Refresh competitors and ticker (lightweight)
  const competitorResult = await runBoardCompetitorRefreshCycle();
  const tickerResult = await runBoardTickerRefreshCycle();

  const durationMs = Date.now() - startedAt;

  return NextResponse.json({
    status: "complete",
    durationMs,
    poll: pollResult,
    competitors: competitorResult,
    ticker: tickerResult,
  });
}

// Also support GET for easy testing / Railway cron
export async function GET(request: Request) {
  return POST(request);
}
