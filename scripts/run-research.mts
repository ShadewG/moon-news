import "dotenv/config";

async function main() {
  const { runResearchLineTask } = await import("../src/server/services/research.js");

  const runIds = process.argv.slice(2);

  if (runIds.length === 0) {
    console.log("Usage: npx tsx scripts/run-research.mts <runId1> [runId2] ...");
    process.exit(1);
  }

  for (const id of runIds) {
    console.log(`\nRunning research for ${id}...`);
    const start = Date.now();
    try {
      await runResearchLineTask({ researchRunId: id });
      console.log(`  ✓ Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ Error: ${msg.slice(0, 500)}`);
    }
  }

  console.log("\nAll done");
  process.exit(0);
}

main();
