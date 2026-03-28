import "server-only";

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getEnv } from "@/server/config/env";

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 60_000;

type AgentReachChannelState = "ok" | "warn" | "off" | "error";

export interface AgentReachChannelStatus {
  status: AgentReachChannelState;
  name: string;
  message: string;
  tier: number;
  backends: string[];
}

export interface AgentReachHealth {
  available: boolean;
  generatedAt: string;
  pythonBin: string | null;
  okCount: number;
  totalCount: number;
  error: string | null;
  keyChannels: Partial<Record<"youtube" | "twitter" | "reddit" | "bilibili" | "web", AgentReachChannelStatus>>;
  channels: Record<string, AgentReachChannelStatus>;
}

let cachedHealth:
  | {
      expiresAt: number;
      value: AgentReachHealth;
    }
  | undefined;

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function pythonHasAgentReach(pythonBin: string): Promise<boolean> {
  try {
    await execFileAsync(
      pythonBin,
      ["-c", "import agent_reach"],
      { timeout: 8_000, env: buildAgentReachExecEnv() },
    );
    return true;
  } catch {
    return false;
  }
}

function buildAgentReachExecEnv() {
  const currentPath = process.env.PATH ?? "";
  const home = process.env.HOME ?? "/home/claude";
  const extraBins = [
    path.join(home, ".local", "bin"),
  ];

  return {
    ...process.env,
    PATH: [...extraBins, currentPath].filter(Boolean).join(":"),
  };
}

async function resolveAgentReachPython(): Promise<string | null> {
  const configured = getEnv().AGENT_REACH_PYTHON?.trim();
  const candidates = [
    configured,
    "/opt/apps/moon-news/.venv-agent-reach/bin/python",
    "python3",
    "python",
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

  for (const candidate of candidates) {
    if (candidate.includes("/")) {
      if (!(await isExecutableFile(candidate))) {
        continue;
      }
    }

    if (await pythonHasAgentReach(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function fetchAgentReachDoctor(pythonBin: string): Promise<Record<string, AgentReachChannelStatus>> {
  const script = [
    "import json",
    "from agent_reach.config import Config",
    "from agent_reach.doctor import check_all",
    "print(json.dumps(check_all(Config()), ensure_ascii=False))",
  ].join("; ");

  const { stdout } = await execFileAsync(
    pythonBin,
    ["-c", script],
    { timeout: 15_000, maxBuffer: 1024 * 1024, env: buildAgentReachExecEnv() },
  );

  const parsed = JSON.parse(stdout) as Record<string, AgentReachChannelStatus>;
  return parsed;
}

export async function getAgentReachHealth(): Promise<AgentReachHealth> {
  const now = Date.now();
  if (cachedHealth && cachedHealth.expiresAt > now) {
    return cachedHealth.value;
  }

  const pythonBin = await resolveAgentReachPython();
  if (!pythonBin) {
    const unavailable = {
      available: false,
      generatedAt: new Date().toISOString(),
      pythonBin: null,
      okCount: 0,
      totalCount: 0,
      error: "Agent Reach is not installed in a discoverable Python environment.",
      keyChannels: {},
      channels: {},
    } satisfies AgentReachHealth;
    cachedHealth = { value: unavailable, expiresAt: now + CACHE_TTL_MS };
    return unavailable;
  }

  try {
    const channels = await fetchAgentReachDoctor(pythonBin);
    const okCount = Object.values(channels).filter((channel) => channel.status === "ok").length;
    const value = {
      available: true,
      generatedAt: new Date().toISOString(),
      pythonBin,
      okCount,
      totalCount: Object.keys(channels).length,
      error: null,
      keyChannels: {
        youtube: channels.youtube,
        twitter: channels.twitter,
        reddit: channels.reddit,
        bilibili: channels.bilibili,
        web: channels.web,
      },
      channels,
    } satisfies AgentReachHealth;
    cachedHealth = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (error) {
    const failed = {
      available: false,
      generatedAt: new Date().toISOString(),
      pythonBin,
      okCount: 0,
      totalCount: 0,
      error: error instanceof Error ? error.message : String(error),
      keyChannels: {},
      channels: {},
    } satisfies AgentReachHealth;
    cachedHealth = { value: failed, expiresAt: now + CACHE_TTL_MS };
    return failed;
  }
}

export function clearAgentReachHealthCache() {
  cachedHealth = undefined;
}
