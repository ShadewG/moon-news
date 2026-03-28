import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runAgentReachDoctor(pythonBin: string) {
  const script = [
    "import json",
    "from agent_reach.config import Config",
    "from agent_reach.doctor import check_all",
    "print(json.dumps(check_all(Config()), ensure_ascii=False))",
  ].join("; ");

  const { stdout } = await execFileAsync(pythonBin, ["-c", script], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });

  return JSON.parse(stdout) as Record<string, unknown>;
}

async function runTranscriptSmokeTest(videoId: string) {
  const { stdout } = await execFileAsync(
    "/opt/apps/moon-news/scripts/yt-dlp-wrapper.sh",
    [
      "--dump-json",
      "--skip-download",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    {
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 8,
    },
  );

  const parsed = JSON.parse(stdout) as {
    id?: string;
    title?: string;
    automatic_captions?: Record<string, unknown>;
    subtitles?: Record<string, unknown>;
  };

  return {
    id: parsed.id ?? videoId,
    title: parsed.title ?? null,
    automaticCaptionLanguages: Object.keys(parsed.automatic_captions ?? {}),
    subtitleLanguages: Object.keys(parsed.subtitles ?? {}),
  };
}

async function main() {
  const pythonBin = process.env.AGENT_REACH_PYTHON || "/opt/apps/moon-news/.venv-agent-reach/bin/python";
  const videoId = process.argv[2] ?? "dQw4w9WgXcQ";

  try {
    const doctor = await runAgentReachDoctor(pythonBin);
    console.log(JSON.stringify({ agentReachDoctor: doctor }, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          agentReachDoctorError: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
  }

  try {
    const transcript = await runTranscriptSmokeTest(videoId);
    console.log(JSON.stringify({ youtubeSmoke: transcript }, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          youtubeSmokeError: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
