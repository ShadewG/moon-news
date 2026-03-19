/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Sets up a self-polling interval to replace Trigger.dev scheduled tasks.
 */
export async function register() {
  // Only run on the server, not during build or in edge runtime
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  const APP_URL = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "http://localhost:3000";

  // Wait 30 seconds after startup before first poll (let DB connections warm up)
  setTimeout(() => {
    console.log(`[cron] Starting self-poll every ${POLL_INTERVAL_MS / 60000} minutes`);

    const poll = async () => {
      try {
        const res = await fetch(`${APP_URL}/api/board/cron`, {
          method: "POST",
          headers: {
            "x-cron-secret": process.env.CRON_SECRET || "",
          },
        });
        if (res.ok) {
          const data = await res.json();
          console.log(
            `[cron] Poll complete — ${data.poll?.feedItemsIngested ?? 0} items, ${data.poll?.storiesCreated ?? 0} stories, ${data.durationMs}ms`
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
