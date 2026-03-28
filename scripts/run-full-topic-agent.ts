import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env") });
loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), override: true });

type Step = {
  label: string;
  scriptPath: string;
  args: string[];
  required?: boolean;
};

type StepRunResult = {
  label: string;
  scriptPath: string;
  args: string[];
  required: boolean;
  status: "completed" | "failed";
  startedAt: string;
  finishedAt: string;
  error?: string;
};

type RunConfig = {
  slug: string;
  title: string;
  briefPath: string | null;
  includeTikTok: boolean;
  includeStaticWriterPack: boolean;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "story";
}

function parseArgs(argv: string[]): RunConfig {
  let slug: string | null = null;
  let title: string | null = null;
  let briefPath: string | null = null;
  let includeTikTok = true;
  let includeStaticWriterPack = true;

  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--slug") {
      slug = argv[index + 1]?.trim() || null;
      index += 1;
      continue;
    }

    if (arg === "--brief") {
      briefPath = argv[index + 1]?.trim() || null;
      index += 1;
      continue;
    }

    if (arg === "--skip-tiktok") {
      includeTikTok = false;
      continue;
    }

    if (arg === "--skip-static") {
      includeStaticWriterPack = false;
      continue;
    }

    positionals.push(arg);
  }

  if (positionals.length === 0) {
    throw new Error(
      "Usage: tsx scripts/run-full-topic-agent.ts <story title> [brief-path] [--slug <slug>] [--brief <path>] [--skip-tiktok] [--skip-static]"
    );
  }

  title = positionals[0]?.trim() || null;
  if (!title) {
    throw new Error("A story title is required.");
  }

  if (!briefPath && positionals[1]) {
    briefPath = positionals[1].trim();
  }

  return {
    slug: slugify(slug || title),
    title,
    briefPath,
    includeTikTok,
    includeStaticWriterPack,
  };
}

function buildSteps(config: RunConfig): Step[] {
  const steps: Step[] = [
    {
      label: "direct research packet",
      scriptPath: "scripts/build-direct-research-outline-report.ts",
      args: [config.slug, config.title, ...(config.briefPath ? [config.briefPath] : [])],
    },
    {
      label: "media collector",
      scriptPath: "scripts/build-media-collector.ts",
      args: [config.slug],
    },
    {
      label: "media mission scan",
      scriptPath: "scripts/build-media-mission-scan.ts",
      args: [config.slug],
    },
    {
      label: "writer pack",
      scriptPath: "scripts/build-writer-pack.ts",
      args: [config.slug],
    },
  ];

  if (config.includeTikTok) {
    steps.push({
      label: "tiktok collector",
      scriptPath: "scripts/collect-tiktok-sources.ts",
      args: [config.slug],
      required: false,
    });
    steps.push({
      label: "writer pack refresh",
      scriptPath: "scripts/build-writer-pack.ts",
      args: [config.slug],
      required: false,
    });
  }

  if (config.includeStaticWriterPack) {
    steps.push({
      label: "static writer pack",
      scriptPath: "scripts/render-static-writer-pack.ts",
      args: [config.slug],
      required: false,
    });
  }

  return steps;
}

function runStep(step: Step) {
  return new Promise<StepRunResult>((resolve, reject) => {
    const startedAt = new Date().toISOString();
    console.log(`[topic-agent] starting ${step.label}`);

    const child = spawn("npx", ["tsx", step.scriptPath, ...step.args], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        NODE_OPTIONS: `--require ${path.join(process.cwd(), "scripts", "server-only-stub.cjs")}${
          process.env.NODE_OPTIONS ? ` ${process.env.NODE_OPTIONS}` : ""
        }`,
      },
    });

    child.on("exit", (code) => {
      const finishedAt = new Date().toISOString();
      if (code === 0) {
        console.log(`[topic-agent] finished ${step.label}`);
        resolve({
          label: step.label,
          scriptPath: step.scriptPath,
          args: step.args,
          required: step.required !== false,
          status: "completed",
          startedAt,
          finishedAt,
        });
        return;
      }

      const result: StepRunResult = {
        label: step.label,
        scriptPath: step.scriptPath,
        args: step.args,
        required: step.required !== false,
        status: "failed",
        startedAt,
        finishedAt,
        error: `${step.label} failed with exit code ${code ?? "unknown"}`,
      };

      if (step.required === false) {
        console.warn(`[topic-agent] optional step failed: ${result.error}`);
        resolve(result);
        return;
      }

      reject(new Error(result.error));
    });

    child.on("error", (error) => {
      const finishedAt = new Date().toISOString();
      const result: StepRunResult = {
        label: step.label,
        scriptPath: step.scriptPath,
        args: step.args,
        required: step.required !== false,
        status: "failed",
        startedAt,
        finishedAt,
        error: error.message,
      };

      if (step.required === false) {
        console.warn(`[topic-agent] optional step failed: ${result.error}`);
        resolve(result);
        return;
      }

      reject(error);
    });
  });
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const steps = buildSteps(config);
  const results: StepRunResult[] = [];

  for (const step of steps) {
    const result = await runStep(step);
    results.push(result);
  }

  const finishedAt = new Date().toISOString();
  const manifest = {
    version: "topic-agent/v1",
    meta: {
      slug: config.slug,
      title: config.title,
      startedAt,
      finishedAt,
      includeTikTok: config.includeTikTok,
      includeStaticWriterPack: config.includeStaticWriterPack,
      briefPath: config.briefPath ? path.resolve(process.cwd(), config.briefPath) : null,
    },
    steps: results,
    outputs: {
      packetPath: path.resolve(process.cwd(), "research", `research-packet-${config.slug}.json`),
      collectorPath: path.resolve(process.cwd(), "research", `media-collector-${config.slug}.json`),
      missionScanPath: path.resolve(process.cwd(), "research", `media-mission-scan-${config.slug}.json`),
      writerPackPath: path.resolve(process.cwd(), "research", `writer-pack-${config.slug}.json`),
      tiktokCollectorPath: config.includeTikTok
        ? path.resolve(process.cwd(), "research", `tiktok-collector-${config.slug}.json`)
        : null,
      staticWriterPackPath: config.includeStaticWriterPack
        ? path.resolve(process.cwd(), "public", "research", "writer-packets", config.slug, "index.html")
        : null,
    },
    urls: {
      packet: `https://moon-internal.xyz/research/packets/${config.slug}`,
      mediaCollector: `https://moon-internal.xyz/research/media-collector/${config.slug}`,
      missionScan: `https://moon-internal.xyz/research/media-mission-scan/${config.slug}`,
      writerPack: `https://moon-internal.xyz/research/writer-packets/${config.slug}/`,
    },
  };

  const manifestPath = path.resolve(process.cwd(), "research", `topic-agent-run-${config.slug}.json`);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(JSON.stringify({ ...manifest, manifestPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
