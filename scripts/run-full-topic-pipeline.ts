import { spawn } from "node:child_process";
import path from "node:path";

type Step = {
  label: string;
  scriptPath: string;
  args: string[];
};

function runStep(step: Step) {
  return new Promise<void>((resolve, reject) => {
    console.log(`[pipeline] starting ${step.label}`);
    const child = spawn(
      "npx",
      ["tsx", step.scriptPath, ...step.args],
      {
        cwd: process.cwd(),
        stdio: "inherit",
        shell: false,
        env: {
          ...process.env,
          NODE_OPTIONS: `--require ${path.join(process.cwd(), "scripts", "server-only-stub.cjs")}${
            process.env.NODE_OPTIONS ? ` ${process.env.NODE_OPTIONS}` : ""
          }`,
        },
      }
    );

    child.on("exit", (code) => {
      if (code === 0) {
        console.log(`[pipeline] finished ${step.label}`);
        resolve();
        return;
      }
      reject(new Error(`${step.label} failed with exit code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  const slugArg = process.argv[2]?.trim();
  const titleArg = process.argv[3]?.trim();
  const briefPathArg = process.argv[4]?.trim();

  if (!slugArg || !titleArg) {
    throw new Error("Usage: tsx scripts/run-full-topic-pipeline.ts <slug> <story title> [brief-path]");
  }

  const steps: Step[] = [
    {
      label: "direct research packet",
      scriptPath: "scripts/build-direct-research-outline-report.ts",
      args: [slugArg, titleArg, ...(briefPathArg ? [briefPathArg] : [])],
    },
    {
      label: "media collector",
      scriptPath: "scripts/build-media-collector.ts",
      args: [slugArg],
    },
    {
      label: "media mission scan",
      scriptPath: "scripts/build-media-mission-scan.ts",
      args: [slugArg],
    },
    {
      label: "writer pack",
      scriptPath: "scripts/build-writer-pack.ts",
      args: [slugArg],
    },
  ];

  for (const step of steps) {
    await runStep(step);
  }

  console.log(
    JSON.stringify(
      {
        slug: slugArg,
        title: titleArg,
        packetPath: path.resolve(process.cwd(), "research", `research-packet-${slugArg}.json`),
        collectorPath: path.resolve(process.cwd(), "research", `media-collector-${slugArg}.json`),
        missionScanPath: path.resolve(process.cwd(), "research", `media-mission-scan-${slugArg}.json`),
        writerPackPath: path.resolve(process.cwd(), "research", `writer-pack-${slugArg}.json`),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
