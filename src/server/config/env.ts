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
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  OPENAI_VIDEO_MODEL: z.string().default("sora-2"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-2.5-flash-image"),
  PARALLEL_API_KEY: z.string().min(1).optional(),
  FIRECRAWL_API_KEY: z.string().min(1).optional(),
  YOUTUBE_API_KEY: z.string().min(1).optional(),
  GOOGLE_CSE_API_KEY: z.string().min(1).optional(),
  GOOGLE_CSE_CX: z.string().min(1).optional(),
  XAI_API_KEY: z.string().min(1).optional(),
  GETTY_API_KEY: z.string().min(1).optional(),
  STORYBLOCKS_API_KEY: z.string().min(1).optional(),
  ARTLIST_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  TRIGGER_SECRET_KEY: z.string().min(1).optional(),
  TRIGGER_PROJECT_REF: z.string().min(1).optional(),
  ENABLE_ARTLIST_FOOTAGE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ENABLE_GEMINI_IMAGE_FALLBACK: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  MAX_RESEARCH_SOURCES_PER_LINE: z.coerce.number().int().positive().default(5),
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

export function isTriggerConfigured(): boolean {
  const env = getEnv();

  return Boolean(env.TRIGGER_SECRET_KEY && env.TRIGGER_PROJECT_REF);
}
