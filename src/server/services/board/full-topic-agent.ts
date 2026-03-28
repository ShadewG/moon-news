import "server-only";

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { desc, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  boardFeedItems,
  boardStoryCandidates,
  boardStorySources,
  researchProgress,
} from "@/server/db/schema";

const execFileAsync = promisify(execFile);

function buildPublicUrls(slug: string) {
  return {
    writerPack: `https://moon-internal.xyz/research/writer-packets/${slug}/`,
    packet: `https://moon-internal.xyz/research/packets/${slug}`,
    missionScan: `https://moon-internal.xyz/research/media-mission-scan/${slug}`,
    mediaCollector: `https://moon-internal.xyz/research/media-collector/${slug}`,
  };
}

async function updateProgress(
  progressId: string,
  step: string,
  progress: number,
  message: string,
  metadata?: Record<string, unknown>
) {
  const db = getDb();
  await db
    .update(researchProgress)
    .set({
      step,
      progress,
      message,
      metadataJson: metadata ?? null,
      updatedAt: new Date(),
    })
    .where(eq(researchProgress.id, progressId));
}

function buildBriefMarkdown(args: {
  title: string;
  vertical: string | null;
  sources: Array<{
    title: string;
    url: string;
    summary: string | null;
    author: string | null;
  }>;
}) {
  const lines = [
    `## ${args.title}`,
    "",
    "### Thesis",
    `Story pulled from the Moon news board for full topic research. Investigate the strongest documentary angle hiding inside "${args.title}".`,
    "",
  ];

  if (args.vertical) {
    lines.push("### Vertical", args.vertical, "");
  }

  if (args.sources.length > 0) {
    lines.push("### Source Headlines");
    for (const source of args.sources.slice(0, 12)) {
      lines.push(`- [${source.title}](${source.url})`);
    }
    lines.push("");

    const summaries = args.sources
      .map((source) => {
        const parts = [
          source.author ? `${source.author}:` : null,
          source.summary?.trim() || null,
        ].filter(Boolean);
        return parts.length > 0 ? `- ${parts.join(" ")}` : null;
      })
      .filter((value): value is string => Boolean(value))
      .slice(0, 8);

    if (summaries.length > 0) {
      lines.push("### Current Coverage Notes", ...summaries, "");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

export async function runFullTopicAgentForBoardStory(input: {
  storyId: string;
  progressId: string;
}) {
  const db = getDb();

  await updateProgress(
    input.progressId,
    "preparing_full_agent",
    5,
    "Preparing full topic research..."
  );

  const story = await db
    .select()
    .from(boardStoryCandidates)
    .where(eq(boardStoryCandidates.id, input.storyId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!story) {
    throw new Error(`Story not found: ${input.storyId}`);
  }

  const sources = await db
    .select({
      title: boardFeedItems.title,
      url: boardFeedItems.url,
      summary: boardFeedItems.summary,
      author: boardFeedItems.author,
    })
    .from(boardStorySources)
    .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId))
    .where(eq(boardStorySources.storyId, input.storyId))
    .orderBy(desc(boardStorySources.sourceWeight))
    .limit(12);

  const slug = story.slug;
  const urls = buildPublicUrls(slug);
  const briefPath = path.resolve(process.cwd(), "research", "board-briefs", `${slug}.md`);
  await mkdir(path.dirname(briefPath), { recursive: true });
  await writeFile(
    briefPath,
    buildBriefMarkdown({
      title: story.canonicalTitle,
      vertical: story.vertical ?? null,
      sources,
    }),
    "utf8"
  );

  await updateProgress(
    input.progressId,
    "running_full_agent",
    15,
    "Running full topic agent...",
    {
      slug,
      urls,
      briefPath,
    }
  );

  try {
    await execFileAsync(
      "npm",
      ["run", "topic:agent", "--", story.canonicalTitle, "--slug", slug, "--brief", briefPath],
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      }
    );
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    const detail = [err.stderr, err.stdout, err.message].filter(Boolean).join("\n").slice(-4000);
    await updateProgress(
      input.progressId,
      "failed",
      100,
      "Full topic research failed.",
      {
        slug,
        urls,
        error: detail,
      }
    );
    throw error;
  }

  const manifestPath = path.resolve(process.cwd(), "research", `topic-agent-run-${slug}.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    outputs?: Record<string, unknown>;
    urls?: Record<string, unknown>;
  };

  await updateProgress(
    input.progressId,
    "complete",
    100,
    "Full topic research complete.",
    {
      slug,
      manifestPath,
      outputs: manifest.outputs ?? null,
      urls: manifest.urls ?? urls,
    }
  );

  return {
    slug,
    manifestPath,
    urls: manifest.urls ?? urls,
    outputs: manifest.outputs ?? null,
  };
}
