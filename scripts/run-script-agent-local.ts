import * as agent from "../src/server/services/script-agent";

async function main() {
  const runId = process.argv[2];

  if (!runId) {
    throw new Error("Usage: run-script-agent-local.ts <runId>");
  }

  await agent.runScriptAgentTask({ runId });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
