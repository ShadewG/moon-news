/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Sets up a self-polling interval to replace Trigger.dev scheduled tasks.
 */
export async function register() {
  // Only run on the server, not during build or in edge runtime
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const isProduction = process.env.NODE_ENV === "production";
  const selfPollEnabled = isProduction
    ? process.env.ENABLE_BOARD_SELF_POLL === "true"
    : process.env.ENABLE_BOARD_DEV_CRON === "true";

  if (!selfPollEnabled) {
    console.log(
      `[cron] Skipping self-poll in ${isProduction ? "production" : "development"}`
    );
    return;
  }

  const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  const internalPort =
    process.env.PORT && /^\d+$/.test(process.env.PORT)
      ? process.env.PORT
      : "3100";
  const SELF_POLL_PATH = process.env.BOARD_SELF_POLL_PATH || "/api/board/poll";
  const APP_URL =
    process.env.BOARD_SELF_POLL_URL ||
    process.env.INTERNAL_APP_URL ||
    `http://127.0.0.1:${internalPort}`;

  // Wait 30 seconds after startup before first poll (let DB connections warm up)
  setTimeout(() => {
    console.log(`[cron] Starting self-poll every ${POLL_INTERVAL_MS / 60000} minutes`);

    const poll = async () => {
      try {
        const res = await fetch(`${APP_URL}${SELF_POLL_PATH}`, {
          method: "POST",
          headers: {
            "x-cron-secret": process.env.CRON_SECRET || "",
          },
        });
        if (res.ok) {
          const data = await res.json();
          console.log(
            `[cron] Poll complete — ${data.feedItemsIngested ?? data.poll?.feedItemsIngested ?? 0} items, ${data.storiesCreated ?? data.poll?.storiesCreated ?? 0} stories, ${data.durationMs ?? "n/a"}ms`
          );
        } else {
          console.error(`[cron] Poll failed: ${res.status}`);
        }
      } catch (err) {
        console.error("[cron] Poll error:", err instanceof Error ? err.message : err);
      }
    };

    // Run immediately, then every 15 minutes
    poll();
    setInterval(poll, POLL_INTERVAL_MS);
  }, 30_000);
}
