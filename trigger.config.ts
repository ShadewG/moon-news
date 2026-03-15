import { defineConfig } from "@trigger.dev/sdk/v3";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

const triggerEnvKeys = [
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_RESEARCH_MODEL",
  "PARALLEL_API_KEY",
  "FIRECRAWL_API_KEY",
  "YOUTUBE_API_KEY",
  "GOOGLE_CSE_API_KEY",
  "GOOGLE_CSE_CX",
  "GETTY_API_KEY",
  "STORYBLOCKS_API_KEY",
  "TRIGGER_PROJECT_REF",
];

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_lriermmczptpoaqhagfd",
  runtime: "node",
  maxDuration: 300,
  dirs: ["./src/trigger"],
  build: {
    extensions: [
      syncEnvVars(() =>
        Object.fromEntries(
          triggerEnvKeys
            .map((key) => [key, process.env[key]])
            .filter((entry): entry is [string, string] => Boolean(entry[1]))
        )
      ),
    ],
  },
});
