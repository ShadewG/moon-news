import * as moonAnalysis from "../src/server/services/moon-analysis";

async function main() {
  const runId = process.argv[2];

  if (!runId) {
    throw new Error("Usage: run-moon-analysis-local.ts <runId>");
  }

  await moonAnalysis.runMoonAnalysisTask({ runId });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
