import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import OpenAI from "openai";

import { requireEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import {
  boardCompetitorPosts,
  boardFeedItems,
  boardQueueItems,
  boardSources,
  boardStoryAiOutputs,
  boardStoryCandidates,
  boardStorySources,
} from "@/server/db/schema";

// ─── OpenAI Client (follows same pattern as providers/openai.ts) ───

let openaiClient: OpenAI | undefined;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY"),
    });
  }
  return openaiClient;
}

// ─── Score Calculation ───

export async function scoreStory(storyId: string): Promise<number> {
  const db = getDb();

  const [story] = await db
    .select()
    .from(boardStoryCandidates)
    .where(eq(boardStoryCandidates.id, storyId))
    .limit(1);

  if (!story) {
    throw new Error(`Story not found: ${storyId}`);
  }

  // Count distinct sources linked to this story
  const [sourceCountResult] = await db
    .select({
      count: sql<number>`count(DISTINCT ${boardStorySources.feedItemId})::int`,
    })
    .from(boardStorySources)
    .where(eq(boardStorySources.storyId, storyId));

  const sourceCount = sourceCountResult?.count ?? 0;

  // Check for competitor overlap — any competitor posts with matching words in title
  const [overlapResult] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(boardCompetitorPosts)
    .where(
      sql`lower(${boardCompetitorPosts.title}) LIKE '%' || lower(${story.canonicalTitle.split(" ").slice(0, 3).join(" ")}) || '%'`
    );

  const competitorOverlap = Math.min(overlapResult?.count ?? 0, 3); // Cap at 3

  // Calculate recency bonus: higher score for newer stories
  const hoursSinceLastSeen = story.lastSeenAt
    ? (Date.now() - story.lastSeenAt.getTime()) / (1000 * 60 * 60)
    : 999;
  const recency = Math.max(0, Math.min(10, 10 - hoursSinceLastSeen / 2.4));

  // Authority: derived from source count (proxy for how many reputable outlets cover it)
  const authority = Math.min(10, sourceCount * 2);

  // Score formula: source_count * 8 + authority * 5 + controversy * 3 + recency + surge_multiplier + competitor_overlap * 10
  const score =
    sourceCount * 8 +
    authority * 5 +
    story.controversyScore * 3 +
    Math.round(recency) +
    story.surgeScore +
    competitorOverlap * 10;

  // Persist score breakdown
  await db
    .update(boardStoryCandidates)
    .set({
      sourcesCount: sourceCount,
      scoreJson: {
        sourceCount,
        authority,
        controversy: story.controversyScore,
        recency: Math.round(recency),
        surgeMultiplier: story.surgeScore,
        competitorOverlap,
        total: score,
      },
      updatedAt: new Date(),
    })
    .where(eq(boardStoryCandidates.id, storyId));

  return score;
}

// ─── Story CRUD ───

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export async function createStoryFromItems(
  title: string,
  feedItemIds: string[],
  type: "normal" | "trending" | "controversy" | "competitor" | "correction" = "normal",
  vertical?: string
): Promise<string> {
  const db = getDb();

  const slug = slugify(title) + "-" + Date.now().toString(36);

  const [story] = await db
    .insert(boardStoryCandidates)
    .values({
      slug,
      canonicalTitle: title,
      vertical: vertical ?? null,
      storyType: type,
      itemsCount: feedItemIds.length,
      sourcesCount: feedItemIds.length,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    .returning({ id: boardStoryCandidates.id });

  if (feedItemIds.length > 0) {
    await db.insert(boardStorySources).values(
      feedItemIds.map((feedItemId, index) => ({
        storyId: story.id,
        feedItemId,
        isPrimary: index === 0,
        sourceWeight: feedItemIds.length - index,
      }))
    );
  }

  // Score the newly created story
  await scoreStory(story.id);

  return story.id;
}

export type StoryFilter = {
  status?: "developing" | "watching" | "peaked" | "queued" | "archived";
  storyType?: "normal" | "trending" | "controversy" | "competitor" | "correction";
  vertical?: string;
};

export type StorySort = "score" | "recent" | "controversy" | "sources";

export async function getStories(
  filter?: StoryFilter,
  sort: StorySort = "score"
) {
  const db = getDb();

  const filters = [];
  if (filter?.status) {
    filters.push(eq(boardStoryCandidates.status, filter.status));
  }
  if (filter?.storyType) {
    filters.push(eq(boardStoryCandidates.storyType, filter.storyType));
  }
  if (filter?.vertical) {
    filters.push(eq(boardStoryCandidates.vertical, filter.vertical));
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const orderBy =
    sort === "recent"
      ? [desc(boardStoryCandidates.lastSeenAt)]
      : sort === "controversy"
        ? [desc(boardStoryCandidates.controversyScore), desc(boardStoryCandidates.lastSeenAt)]
        : sort === "sources"
          ? [desc(boardStoryCandidates.sourcesCount), desc(boardStoryCandidates.lastSeenAt)]
          : [
              desc(
                sql`COALESCE((${boardStoryCandidates.scoreJson}->>'total')::int, 0)`
              ),
              desc(boardStoryCandidates.lastSeenAt),
            ];

  const stories = await db
    .select({
      story: boardStoryCandidates,
      feedItemCount: sql<number>`(
        SELECT count(*)::int FROM board_story_sources
        WHERE story_id = ${boardStoryCandidates.id}
      )`,
    })
    .from(boardStoryCandidates)
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(100);

  return stories;
}

export async function getStoryDetail(storyId: string) {
  const db = getDb();

  const [story] = await db
    .select()
    .from(boardStoryCandidates)
    .where(eq(boardStoryCandidates.id, storyId))
    .limit(1);

  if (!story) return null;

  const [linkedItems, aiOutputs, queueItem] = await Promise.all([
    db
      .select({
        link: boardStorySources,
        feedItem: boardFeedItems,
        sourceName: boardSources.name,
      })
      .from(boardStorySources)
      .innerJoin(
        boardFeedItems,
        eq(boardFeedItems.id, boardStorySources.feedItemId)
      )
      .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
      .where(eq(boardStorySources.storyId, storyId))
      .orderBy(desc(boardStorySources.sourceWeight)),
    db
      .select()
      .from(boardStoryAiOutputs)
      .where(eq(boardStoryAiOutputs.storyId, storyId))
      .orderBy(desc(boardStoryAiOutputs.createdAt)),
    db
      .select()
      .from(boardQueueItems)
      .where(eq(boardQueueItems.storyId, storyId))
      .limit(1),
  ]);

  // Check for competitor overlaps
  const titleWords = story.canonicalTitle
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5);

  let competitorOverlaps: typeof boardCompetitorPosts.$inferSelect[] = [];
  if (titleWords.length > 0) {
    const likeConditions = titleWords.map(
      (word) => sql`lower(${boardCompetitorPosts.title}) LIKE ${"%" + word + "%"}`
    );
    competitorOverlaps = await db
      .select()
      .from(boardCompetitorPosts)
      .where(sql`(${sql.join(likeConditions, sql` OR `)})`)
      .orderBy(desc(boardCompetitorPosts.publishedAt))
      .limit(20);
  }

  return {
    story,
    feedItems: linkedItems,
    aiOutputs,
    queueItem: queueItem[0] ?? null,
    competitorOverlaps,
  };
}

export async function updateStoryStatus(
  storyId: string,
  status: "developing" | "watching" | "peaked" | "queued" | "archived"
) {
  const db = getDb();

  await db
    .update(boardStoryCandidates)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(boardStoryCandidates.id, storyId));
}

// ─── AI Generation ───

async function storeAiOutput(
  storyId: string,
  kind: "brief" | "script_starter" | "titles",
  content: string,
  model: string
) {
  const db = getDb();

  await db
    .insert(boardStoryAiOutputs)
    .values({
      storyId,
      kind,
      content,
      model,
      promptVersion: "v1",
    })
    .onConflictDoUpdate({
      target: [
        boardStoryAiOutputs.storyId,
        boardStoryAiOutputs.kind,
        boardStoryAiOutputs.promptVersion,
      ],
      set: {
        content,
        model,
        updatedAt: new Date(),
      },
    });
}

export async function getStoryContext(storyId: string): Promise<{
  title: string;
  items: Array<{ title: string; summary: string | null; source: string; url: string }>;
}> {
  const db = getDb();

  const [story] = await db
    .select()
    .from(boardStoryCandidates)
    .where(eq(boardStoryCandidates.id, storyId))
    .limit(1);

  if (!story) throw new Error(`Story not found: ${storyId}`);

  const linkedItems = await db
    .select({
      feedItem: boardFeedItems,
      sourceName: boardSources.name,
    })
    .from(boardStorySources)
    .innerJoin(
      boardFeedItems,
      eq(boardFeedItems.id, boardStorySources.feedItemId)
    )
    .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
    .where(eq(boardStorySources.storyId, storyId))
    .orderBy(desc(boardStorySources.sourceWeight))
    .limit(20);

  return {
    title: story.canonicalTitle,
    items: linkedItems.map((r) => ({
      title: r.feedItem.title,
      summary: r.feedItem.summary,
      source: r.sourceName,
      url: r.feedItem.url,
    })),
  };
}

export async function generateBrief(storyId: string): Promise<string> {
  const ctx = await getStoryContext(storyId);
  const model = "gpt-4.1-mini";

  const sourcesText = ctx.items
    .map(
      (item, i) =>
        `${i + 1}. [${item.source}] "${item.title}"\n   ${item.summary?.slice(0, 300) ?? "No summary"}\n   ${item.url}`
    )
    .join("\n\n");

  const response = await getOpenAIClient().responses.create({
    model,
    input: [
      {
        role: "system",
        content: `You are a research briefing writer for a YouTube news channel. Write a concise, factual briefing that:
- Summarizes the key facts of the story
- Identifies the main players/companies/entities involved
- Notes any controversy or competing narratives
- Highlights what makes this story interesting for a YouTube audience
- Suggests angles that would work well for video content
- Flags any gaps in the coverage that need more research

Keep it under 500 words. Be direct, no fluff.`,
      },
      {
        role: "user",
        content: `Story: "${ctx.title}"\n\nSources:\n${sourcesText}`,
      },
    ],
  });

  const content = response.output_text.trim();
  await storeAiOutput(storyId, "brief", content, model);
  return content;
}

export async function generateScriptDraft(storyId: string): Promise<string> {
  const ctx = await getStoryContext(storyId);
  const model = "gpt-4.1-mini";

  const sourcesText = ctx.items
    .map(
      (item, i) =>
        `${i + 1}. [${item.source}] "${item.title}" — ${item.summary?.slice(0, 200) ?? ""}`
    )
    .join("\n");

  const response = await getOpenAIClient().responses.create({
    model,
    input: [
      {
        role: "system",
        content: `You are a script writer for a YouTube tech/news channel. Write the opening 60-90 seconds of a video script that:
- Opens with a strong hook (question, shocking stat, or bold statement)
- Establishes why the viewer should care RIGHT NOW
- Previews what the video will cover
- Uses conversational, engaging language — not corporate speak
- Includes natural pause points and emphasis markers

Format the script with clear paragraph breaks. Mark emphasis with *asterisks*.
Keep it under 300 words (roughly 60-90 seconds of speaking).`,
      },
      {
        role: "user",
        content: `Story: "${ctx.title}"\n\nSource material:\n${sourcesText}`,
      },
    ],
  });

  const content = response.output_text.trim();
  await storeAiOutput(storyId, "script_starter", content, model);
  return content;
}

export async function generateTitles(storyId: string): Promise<string> {
  const ctx = await getStoryContext(storyId);
  const model = "gpt-4.1-mini";

  const sourcesText = ctx.items
    .map((item) => `- [${item.source}] "${item.title}"`)
    .join("\n");

  const response = await getOpenAIClient().responses.create({
    model,
    input: [
      {
        role: "system",
        content: `You generate YouTube video title options. Create exactly 5 title options that:
1. Are under 60 characters each
2. Use power words and curiosity gaps
3. Avoid clickbait that doesn't deliver
4. Include relevant keywords for search
5. Range from conservative/informative to bold/provocative

Format: number each title on its own line. No additional commentary.`,
      },
      {
        role: "user",
        content: `Story: "${ctx.title}"\n\nSource headlines:\n${sourcesText}`,
      },
    ],
  });

  const content = response.output_text.trim();
  await storeAiOutput(storyId, "titles", content, model);
  return content;
}
