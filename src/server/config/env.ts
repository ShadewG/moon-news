import "server-only";

import path from "node:path";

import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1).optional(),
  MEDIA_ROOT: z.string().default(".moon-news-media"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_RESEARCH_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_MEDIA_SOURCE_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_QUOTE_EXTRACTION_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TRANSCRIPT_SCAN_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_STORY_DEDUP_MODEL: z.string().default("gpt-5.4-nano"),
  ENABLE_AI_STORY_DEDUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ANTHROPIC_QUOTE_EXTRACTION_MODEL: z.string().default("claude-sonnet-4-6"),
  BOARD_AI_SCORING_PROFILE: z
    .enum(["default", "mens", "online_culture"])
    .default("online_culture"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  OPENAI_VIDEO_MODEL: z.string().default("sora-2"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_PLANNING_MODEL: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_WRITING_MODEL: z.string().default("claude-sonnet-4-6"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-2.5-flash-image"),
  PARALLEL_API_KEY: z.string().min(1).optional(),
  PARALLEL_DEEP_RESEARCH_PROCESSOR: z.string().default("pro-fast"),
  FIRECRAWL_API_KEY: z.string().min(1).optional(),
  YOUTUBE_API_KEY: z.string().min(1).optional(),
  GOOGLE_CSE_API_KEY: z.string().min(1).optional(),
  GOOGLE_CSE_CX: z.string().min(1).optional(),
  XAI_API_KEY: z.string().min(1).optional(),
  XAI_SEARCH_MODEL: z.string().default("grok-4-1-fast-non-reasoning"),
  AGENT_REACH_PYTHON: z.string().default("/opt/apps/moon-news/.venv-agent-reach/bin/python"),
  ENABLE_X_SEARCH: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  DISCORD_BOARD_CHANNEL_ID: z.string().min(1).optional(),
  ENABLE_DISCORD_BOARD_NOTIFICATIONS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ENABLE_BOARD_POLL_ALERTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ENABLE_BOARD_CRON_POLL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ENABLE_BOARD_HEAVY_WEB_ROUTES: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ENABLE_BOARD_READ_MAINTENANCE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BOARD_POLL_RSS_SOURCES_PER_RUN: z.coerce.number().int().positive().default(6),
  BOARD_POLL_X_SOURCES_PER_RUN: z.coerce.number().int().positive().default(3),
  BOARD_POLL_TIKTOK_SOURCES_PER_RUN: z.coerce.number().int().positive().default(6),
  BOARD_TIKTOK_TRANSCRIPT_ENRICHMENT_LIMIT: z.coerce.number().int().positive().default(2),
  BOARD_TIKTOK_TRANSCRIPT_LOOKBACK_HOURS: z.coerce.number().int().positive().default(48),
  BOARD_TIKTOK_TRANSCRIPT_MIN_VIEWS: z.coerce.number().int().nonnegative().default(150000),
  BOARD_POLL_PROCESSING_BATCH_SIZE: z.coerce.number().int().positive().default(5),
  BOARD_POLL_IMMEDIATE_RESCORING_LIMIT: z.coerce.number().int().nonnegative().default(4),
  DISCORD_BOARD_MIN_VISIBILITY: z.coerce.number().int().min(0).max(100).default(45),
  DISCORD_BOARD_MAX_MESSAGES_PER_POLL: z.coerce.number().int().positive().default(1),
  DISCORD_BOARD_LOOKBACK_HOURS: z.coerce.number().int().positive().default(24),
  IDEATION_BACKEND_URL: z.string().url().default("http://127.0.0.1:8000"),
  GETTY_API_KEY: z.string().min(1).optional(),
  STORYBLOCKS_API_KEY: z.string().min(1).optional(),
  ARTLIST_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  SERPER_API_KEY: z.string().min(1).optional(),
  PERPLEXITY_API_KEY: z.string().min(1).optional(),
  PERPLEXITY_RESEARCH_MODEL: z.string().default("sonar-pro"),
  PERPLEXITY_FALLBACK_MODEL: z.string().default("sonar"),
  TRIGGER_SECRET_KEY: z.string().min(1).optional(),
  TRIGGER_PROJECT_REF: z.string().min(1).optional(),
  FORCE_INLINE_TRIGGER: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ENABLE_ARTLIST_FOOTAGE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ENABLE_GEMINI_IMAGE_FALLBACK: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  MAX_RESEARCH_SOURCES_PER_LINE: z.coerce.number().int().positive().default(5),
  MOON_YTDLP_BIN: z.string().default("/opt/apps/moon-news/scripts/yt-dlp-wrapper.sh"),
  MOON_YTDLP_PROXY: z.string().optional(),
  TIKTOK_PLAYWRIGHT_PROFILE_ROOT: z.string().default("data/playwright/tiktok-profiles"),
  LOCAL_MEDIA_CACHE_DIR: z.string().default("data/media-cache"),
  LOCAL_TRANSCRIBE_PYTHON: z
    .string()
    .default("/opt/apps/moon-news/.venv-whisper/bin/python"),
  LOCAL_WHISPER_MODEL: z.string().default("base.en"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  if (!cachedEnv) {
    cachedEnv = serverEnvSchema.parse(process.env);
  }

  return cachedEnv;
}

export function requireEnv<Key extends keyof ServerEnv>(
  key: Key
): NonNullable<ServerEnv[Key]> {
  const value = getEnv()[key];

  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${String(key)}`);
  }

  return value as NonNullable<ServerEnv[Key]>;
}

export function getMediaRoot(): string {
  const { MEDIA_ROOT } = getEnv();

  return path.isAbsolute(MEDIA_ROOT)
    ? MEDIA_ROOT
    : path.resolve(process.cwd(), MEDIA_ROOT);
}

export function getLocalMediaCacheRoot(): string {
  const { LOCAL_MEDIA_CACHE_DIR } = getEnv();

  return path.isAbsolute(LOCAL_MEDIA_CACHE_DIR)
    ? LOCAL_MEDIA_CACHE_DIR
    : path.resolve(process.cwd(), LOCAL_MEDIA_CACHE_DIR);
}

export function isTriggerConfigured(): boolean {
  const env = getEnv();

  if (env.FORCE_INLINE_TRIGGER) {
    return false;
  }

  return Boolean(env.TRIGGER_SECRET_KEY && env.TRIGGER_PROJECT_REF);
}
