import "server-only";

import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { getDb } from "@/server/db/client";
import {
  boardFeedItems,
  boardStoryAiOutputs,
  boardStoryCandidates,
  boardStorySources,
  researchProgress,
} from "@/server/db/schema";
import { getEnv, requireEnv } from "@/server/config/env";

import { searchNewsStory } from "./news-search";
import { extractContent, type ExtractedContent } from "./content-extractor";
import { scoreStory } from "./story-scorer";

// ─── Types ───

export interface ResearchResult {
  summary: string;
  timeline: Array<{ date: string; event: string }>;
  key_players: Array<{ name: string; role: string }>;
  controversy_score: number;
  format_suggestion: string;
  angle_suggestions: string[];
  title_options: string[];
  script_opener: string;
}

type ResearchMode = "quick" | "full";

// ─── OpenAI client (lazy singleton) ───

let openaiClient: OpenAI | undefined;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY"),
    });
  }
  return openaiClient;
}

// ─── Progress tracking helpers ───

async function createProgress(
  storyId: string
): Promise<string> {
  const db = getDb();
  const rows = await db
    .insert(researchProgress)
    .values({
      storyId,
      taskType: "deep_research",
      step: "pending",
      progress: 0,
      message: "Initializing research...",
    })
    .returning({ id: researchProgress.id });

  return rows[0].id;
}

async function updateProgress(
  progressId: string,
  step: string,
  progress: number,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
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

// ─── Parallel extraction with concurrency limit ───

async function extractWithConcurrencyLimit(
  urls: string[],
  maxConcurrent: number
): Promise<ExtractedContent[]> {
  const results: ExtractedContent[] = [];
  let running = 0;
  let index = 0;

  return new Promise((resolve) => {
    function next() {
      // If all done, resolve
      if (results.length === urls.length) {
        resolve(results);
        return;
      }

      // Launch up to maxConcurrent
      while (running < maxConcurrent && index < urls.length) {
        const currentIndex = index++;
        running++;

        extractContent(urls[currentIndex])
          .then((content) => {
            results[currentIndex] = content;
          })
          .catch(() => {
            results[currentIndex] = {
              title: null,
              content: "",
              author: null,
              publishedAt: null,
              siteName: null,
              wordCount: 0,
            };
          })
          .finally(() => {
            running--;
            next();
          });
      }

      // If nothing left to launch and nothing running, resolve
      if (index >= urls.length && running === 0) {
        resolve(results);
      }
    }

    next();
  });
}

// ─── Synthesize with OpenAI structured output ───

async function synthesizeResearch(
  storyTitle: string,
  vertical: string | null,
  extractedContents: ExtractedContent[]
): Promise<ResearchResult> {
  const ai = getOpenAIClient();
  const model = getEnv().OPENAI_RESEARCH_MODEL;

  // Build context from extracted content
  const sourceSummaries = extractedContents
    .filter((c) => c.content.length > 50)
    .slice(0, 15)
    .map((c, i) => {
      const snippet = c.content.slice(0, 2000);
      const meta = [
        c.title && `Title: ${c.title}`,
        c.siteName && `Source: ${c.siteName}`,
        c.author && `Author: ${c.author}`,
        c.publishedAt && `Date: ${c.publishedAt}`,
      ]
        .filter(Boolean)
        .join(" | ");
      return `[Source ${i + 1}] ${meta}\n${snippet}`;
    })
    .join("\n\n---\n\n");

  const systemPrompt = `You are a news research analyst for a YouTube documentary channel. Analyze the provided source material and produce a structured research brief.

Story: "${storyTitle}"${vertical ? ` | Vertical: ${vertical}` : ""}

Respond with a JSON object matching this exact schema:
{
  "summary": "3-paragraph summary of the story with key facts and context",
  "timeline": [{"date": "YYYY-MM-DD or descriptive", "event": "what happened"}],
  "key_players": [{"name": "person or org name", "role": "their role in the story"}],
  "controversy_score": 0-100,
  "format_suggestion": "Full Video / Short / Both",
  "angle_suggestions": ["angle 1", "angle 2", "angle 3"],
  "title_options": ["title 1", "title 2", "title 3", "title 4", "title 5"],
  "script_opener": "First paragraph of a documentary script about this topic"
}

Be factual, cite specifics from the sources, and suggest angles that would perform well on YouTube.`;

  const response = await ai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Here are the research sources:\n\n${sourceSummaries}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
    max_tokens: 4000,
  });

  const content = response.choices[0]?.message?.content ?? "{}";

  try {
    const parsed = JSON.parse(content) as ResearchResult;
    return {
      summary: parsed.summary ?? "",
      timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
      key_players: Array.isArray(parsed.key_players) ? parsed.key_players : [],
      controversy_score:
        typeof parsed.controversy_score === "number"
          ? parsed.controversy_score
          : 0,
      format_suggestion: parsed.format_suggestion ?? "Full Video",
      angle_suggestions: Array.isArray(parsed.angle_suggestions)
        ? parsed.angle_suggestions
        : [],
      title_options: Array.isArray(parsed.title_options)
        ? parsed.title_options
        : [],
      script_opener: parsed.script_opener ?? "",
    };
  } catch {
    console.error("[story-research] Failed to parse AI response");
    return {
      summary: content,
      timeline: [],
      key_players: [],
      controversy_score: 0,
      format_suggestion: "Full Video",
      angle_suggestions: [],
      title_options: [],
      script_opener: "",
    };
  }
}

// ─── Main deep research function ───

export async function deepResearchStory(
  storyId: string,
  mode: ResearchMode,
  existingProgressId?: string
): Promise<{ progressId: string; result: ResearchResult }> {
  const db = getDb();

  // Use existing progress record or create a new one
  const progressId = existingProgressId ?? (await createProgress(storyId));

  try {
    // Step 1: Get story from DB with linked feed items
    await updateProgress(progressId, "searching", 5, "Loading story data...");

    const story = await db
      .select()
      .from(boardStoryCandidates)
      .where(eq(boardStoryCandidates.id, storyId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!story) {
      await updateProgress(progressId, "failed", 0, "Story not found");
      throw new Error(`Story not found: ${storyId}`);
    }

    // Get linked feed items
    const feedItems = await db
      .select({
        title: boardFeedItems.title,
        url: boardFeedItems.url,
      })
      .from(boardStorySources)
      .innerJoin(
        boardFeedItems,
        eq(boardStorySources.feedItemId, boardFeedItems.id)
      )
      .where(eq(boardStorySources.storyId, storyId));

    // Step 2: Build search query and search
    await updateProgress(
      progressId,
      "searching",
      10,
      `Searching news sources (${mode} mode)...`
    );

    const searchQuery = story.vertical
      ? `${story.canonicalTitle} ${story.vertical}`
      : story.canonicalTitle;

    const searchResults = await searchNewsStory(searchQuery, mode);

    await updateProgress(
      progressId,
      "searching",
      20,
      `Found ${searchResults.length} results from news search`,
      { searchResultCount: searchResults.length }
    );

    // Step 3: Extract content from top results (max 5 concurrent)
    await updateProgress(
      progressId,
      "extracting",
      25,
      "Extracting content from sources..."
    );

    // Combine feed item URLs + search result URLs, deduplicate
    const allUrls = new Set<string>();
    for (const fi of feedItems) {
      if (fi.url) allUrls.add(fi.url);
    }
    for (const sr of searchResults) {
      if (sr.url) allUrls.add(sr.url);
    }

    const urlsToExtract = [...allUrls].slice(0, mode === "quick" ? 8 : 20);

    const extractedContents = await extractWithConcurrencyLimit(
      urlsToExtract,
      5
    );

    const validContents = extractedContents.filter(
      (c) => c.content.length > 50
    );

    await updateProgress(
      progressId,
      "extracting",
      50,
      `Extracted content from ${validContents.length}/${urlsToExtract.length} sources`,
      { extractedCount: validContents.length, totalUrls: urlsToExtract.length }
    );

    // Step 4: Synthesize with OpenAI
    await updateProgress(
      progressId,
      "synthesizing",
      55,
      "AI analyzing and synthesizing research..."
    );

    const result = await synthesizeResearch(
      story.canonicalTitle,
      story.vertical,
      validContents
    );

    await updateProgress(progressId, "synthesizing", 80, "Research synthesis complete");

    // Step 5: Save to board_story_ai_outputs
    await updateProgress(progressId, "scoring", 85, "Saving research brief...");

    await db
      .insert(boardStoryAiOutputs)
      .values({
        storyId,
        kind: "brief",
        promptVersion: "v2-research",
        model: getEnv().OPENAI_RESEARCH_MODEL,
        content: JSON.stringify(result),
        metadataJson: {
          mode,
          searchResultCount: searchResults.length,
          extractedCount: validContents.length,
          sources: searchResults.slice(0, 10).map((s) => ({
            title: s.title,
            url: s.url,
            source: s.source,
          })),
        },
      })
      .onConflictDoUpdate({
        target: [
          boardStoryAiOutputs.storyId,
          boardStoryAiOutputs.kind,
          boardStoryAiOutputs.promptVersion,
        ],
        set: {
          content: JSON.stringify(result),
          metadataJson: {
            mode,
            searchResultCount: searchResults.length,
            extractedCount: validContents.length,
            updatedAt: new Date().toISOString(),
          },
          updatedAt: new Date(),
        },
      });

    // Step 6: Update story score
    await updateProgress(progressId, "scoring", 90, "Calculating story score...");

    // Update controversy score from research
    if (result.controversy_score > 0) {
      await db
        .update(boardStoryCandidates)
        .set({
          controversyScore: result.controversy_score,
          updatedAt: new Date(),
        })
        .where(eq(boardStoryCandidates.id, storyId));
    }

    await scoreStory(storyId);

    // Done
    await updateProgress(progressId, "complete", 100, "Research complete", {
      controversyScore: result.controversy_score,
      formatSuggestion: result.format_suggestion,
      angleCount: result.angle_suggestions.length,
      titleCount: result.title_options.length,
    });

    return { progressId, result };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error during research";
    await updateProgress(progressId, "failed", 0, message).catch(() => {});
    throw err;
  }
}
