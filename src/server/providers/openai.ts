import "server-only";

import OpenAI from "openai";
import { z } from "zod";

import { getEnv, requireEnv } from "@/server/config/env";

let client: OpenAI | undefined;

function getOpenAIClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY"),
    });
  }

  return client;
}

export const articleFactExtractSchema = z.object({
  sourceTitle: z.string().trim().min(1),
  keyFacts: z.array(z.string().trim().min(1)).max(12),
  namedActors: z.array(z.string().trim().min(1)).max(16),
  operationalDetails: z.array(z.string().trim().min(1)).max(12),
  motiveFrames: z.array(z.string().trim().min(1)).max(8),
  relationshipTurns: z.array(z.string().trim().min(1)).max(8),
  deterrents: z.array(z.string().trim().min(1)).max(8),
  exactQuotes: z.array(z.string().trim().min(1)).max(8),
});

export type ArticleFactExtract = z.infer<typeof articleFactExtractSchema>;

function parseLooseJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const trimmed = fenced.trim();

  const candidates = [
    trimmed,
    trimmed.replace(/,\s*([}\]])/g, "$1"),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try narrower extraction below.
    }

    const objectStart = candidate.indexOf("{");
    const arrayStart = candidate.indexOf("[");
    const startCandidates = [objectStart, arrayStart].filter((index) => index >= 0);
    const start = startCandidates.length > 0 ? Math.min(...startCandidates) : -1;
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));

    if (start >= 0 && end > start) {
      const sliced = candidate.slice(start, end + 1);
      try {
        return JSON.parse(sliced);
      } catch {
        try {
          return JSON.parse(sliced.replace(/,\s*([}\]])/g, "$1"));
        } catch {
          // Fall through.
        }
      }
    }
  }

  throw new Error(`Loose JSON parse failed. Output preview: ${trimmed.slice(0, 1200)}`);
}

function sanitizeArticleFactExtract(value: unknown): ArticleFactExtract {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const readStringArray = (key: string, maxItems: number) =>
    Array.isArray(record[key])
      ? record[key]
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, maxItems)
      : [];

  return articleFactExtractSchema.parse({
    sourceTitle:
      typeof record.sourceTitle === "string" && record.sourceTitle.trim().length > 0
        ? record.sourceTitle.trim()
        : "Untitled source",
    keyFacts: readStringArray("keyFacts", 12),
    namedActors: readStringArray("namedActors", 16),
    operationalDetails: readStringArray("operationalDetails", 12),
    motiveFrames: readStringArray("motiveFrames", 8),
    relationshipTurns: readStringArray("relationshipTurns", 8),
    deterrents: readStringArray("deterrents", 8),
    exactQuotes: readStringArray("exactQuotes", 8),
  });
}

export async function extractArticleFactsFromMarkdown(args: {
  sourceUrl: string;
  title?: string | null;
  siteName?: string | null;
  markdown: string;
}): Promise<{
  model: string;
  facts: ArticleFactExtract;
}> {
  const model = getEnv().OPENAI_RESEARCH_MODEL;
  const response = await getOpenAIClient().responses.create({
    model,
    max_output_tokens: 1800,
    input: [
      {
        role: "system",
        content:
          "Extract the most decision-relevant documentary research facts from a scraped article. Preserve sharp specifics, names, motives, operational details, relationship turns, deterrents, and short exact quotes. Return strict JSON only.",
      },
      {
        role: "user",
        content: [
          `Source URL: ${args.sourceUrl}`,
          args.title ? `Title: ${args.title}` : null,
          args.siteName ? `Site: ${args.siteName}` : null,
          "",
          "Article markdown:",
          args.markdown.slice(0, 24000),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "article_fact_extract",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            sourceTitle: { type: "string" },
            keyFacts: { type: "array", items: { type: "string" } },
            namedActors: { type: "array", items: { type: "string" } },
            operationalDetails: { type: "array", items: { type: "string" } },
            motiveFrames: { type: "array", items: { type: "string" } },
            relationshipTurns: { type: "array", items: { type: "string" } },
            deterrents: { type: "array", items: { type: "string" } },
            exactQuotes: { type: "array", items: { type: "string" } },
          },
          required: [
            "sourceTitle",
            "keyFacts",
            "namedActors",
            "operationalDetails",
            "motiveFrames",
            "relationshipTurns",
            "deterrents",
            "exactQuotes",
          ],
        },
      },
    },
  });

  const fallbackTextParts: string[] = [];
  for (const item of response.output ?? []) {
    if (!("content" in item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const contentItem of item.content as Array<unknown>) {
      if (
        contentItem &&
        typeof contentItem === "object" &&
        "text" in contentItem &&
        typeof contentItem.text === "string"
      ) {
        fallbackTextParts.push(contentItem.text);
      }
    }
  }

  const outputText =
    response.output_text ?? (fallbackTextParts.join("\n") || "{}");

  return {
    model,
    facts: sanitizeArticleFactExtract(parseLooseJson(outputText)),
  };
}

// ─── Line Classification ───

export const classificationSchema = z.object({
  category: z.enum([
    "concrete_event",
    "named_person",
    "abstract_concept",
    "quote_claim",
    "historical_period",
    "transition",
    "sample_story",
  ]),
  search_keywords: z.array(z.string()),
  temporal_context: z.string().nullable(),
  ai_generation_recommended: z.boolean(),
  ai_generation_reason: z.string().nullable(),
});

export type LineClassification = z.infer<typeof classificationSchema>;

export const boardStoryAssessmentSchema = z.object({
  boardVisibilityScore: z.number().int().min(0).max(100),
  moonFitScore: z.number().int().min(0).max(100),
  suggestedStoryType: z.enum(["normal", "trending", "controversy"]),
  controversyScore: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  explanation: z.string(),
});

export type BoardStoryAssessment = z.infer<typeof boardStoryAssessmentSchema>;
export type BoardScoringPromptProfile = "default" | "mens" | "online_culture";

export const boardCommentReactionSchema = z.object({
  overallTone: z.enum([
    "skeptical",
    "mocking",
    "angry",
    "concerned",
    "impressed",
    "confused",
    "mixed",
  ]),
  intensity: z.enum(["muted", "active", "loud", "frenzy"]),
  summary: z.string().trim().min(1),
  keyThemes: z.array(z.string().trim().min(1)).max(5),
  standoutCommentIndexes: z.array(z.number().int().min(0).max(15)).max(4),
});

export type BoardCommentReaction = z.infer<typeof boardCommentReactionSchema>;

export const boardStoryDedupDecisionSchema = z.object({
  matchStoryId: z.string().trim().min(1).nullable(),
  sameStory: z.boolean(),
  confidence: z.number().int().min(0).max(100),
  explanation: z.string().trim().min(1),
});

export type BoardStoryDedupDecision = z.infer<typeof boardStoryDedupDecisionSchema>;

function buildBoardStoryAssessmentSystemPrompt(
  profile: BoardScoringPromptProfile
) {
  if (profile === "online_culture") {
    return `You score stories for Moon News' internal editorial board.

Your job is to decide whether the story deserves to surface on the board today as online-culture news. Think about people who live on X, Reddit, YouTube, Twitch, Discord, and group chats; if normal people would barely notice but internet people would instantly know why it matters, that is a strong positive. Prioritize the kind of topics channels like Asmongold, penguinz0, and Moon reliably cover: creator scandals, streamer feuds, platform changes, moderation fights, gaming controversies, game-studio deception, AI slop, AI-generated video blowups, viral Sora / Runway / Veo clips, internet scams, leaks, bans, public humiliations, online harassment mobs, influencer and OnlyFans economy weirdness, dating-subculture discourse, Reddit and Discord chaos, hated Hollywood trailer discourse, remake or live-action backlash, ugly CGI pile-ons, review-bomb cycles, and internet-society stories like job-market hell, enshittification, piracy versus ownership, digital labor absurdity, microtransactions, and AI replacing people.

Start with the headline, then refine using source evidence and attention signals. Separate moonFitScore from boardVisibilityScore: a story can fit Moon in theory but still be weak today. Score for commentary potential, not civic importance. Dry article-headline wording is not a reason to score low if the underlying topic is obvious internet-commentary bait. A story does not need mainstream importance or broad public awareness if it is the sort of concrete online-native topic people on the internet would argue about today. High scores should go to clear online-culture topics with a real event, backlash, platform change, leak, clip, lawsuit, ban, patch, shutdown, scam, meme wave, or public crash-out to react to. Gaming and platform stories should score well when they involve buggy launches, hated patches, monetization backlash, studio fraud or deception claims, moderation fights, disliked AI features, creator feuds, streamer bans, or anti-user product changes; those are real online-culture stories even if they sound like straight news. Entertainment stories can also score well when the discourse is internet-native: a hated trailer drop, first-look mockery, ugly CGI backlash, casting backlash, remake discourse, or a clip that people online are clowning on is a real board story, not just entertainment promo. Viral creator skits, parody bits, satire clips, or meme-heavy reaction waves are real online culture even when the article frames them through partisan outrage; if the core artifact is a creator video, skit, meme, or reaction wave that people online are sharing, do not downscore it just because words like conservative, liberal, MAGA, or politics appear in the headline. By contrast, bills, regulation fights, senators, hearings, and dry policy/process stories should stay low even if they mention AI or tech, unless there is a concrete viral artifact or clear creator/platform pickup. If a topic already has clear pickup from large commentary creators or streamer communities, treat that as a strong signal: a concrete creator-, gaming-, platform-, AI-video-, or pop-culture-backlash topic with real creator pickup should often land in the 45-55 range even if mainstream people barely care. Even without creator pickup, article-style internet-society stories like AI slop backlash, piracy versus ownership fights, Gen Z job-market hell, hated platform or OS changes, viral OnlyFans or influencer-economy moments, and meme-heavy AI video discourse can still land around 35-45 if they feel like obvious online discourse. If the evidence cluster includes the original trailer, teaser, image, clip, or post plus several reaction or backlash stories about that same artifact, treat that as a stronger reaction wave than a single promo item. Raw attention magnitude matters a lot: large view counts, likes, reposts, and several high-engagement posts should push scores up materially even before big creators cover it. Account-relative outliers matter enormously: if a post is doing 3x, 5x, 10x or more than that account's usual views, likes, or reposts, treat it as a major breakout signal, not a minor bonus. A strong account-relative breakout should materially raise the score even before the absolute counts are gigantic, because it often means the topic is escaping the creator's normal audience and turning into a real internet event. Weird official-institution internet spectacle also counts when it becomes a concrete memetic artifact, such as strange White House social posts, humanoid-robot photo ops, or other bizarre official visuals that people online immediately share or mock; do not auto-dismiss those as routine politics if the artifact is vivid and the attention is real. Legal, crime, or bodycam stories should only score high when they are clearly attached to creators, platforms, gaming, internet subcultures, or a viral artifact people online are already sharing. Keep scores low for routine politics, geopolitics, policy process, generic celebrity gossip, mainstream celebrity legal trouble, ordinary crime or court coverage, release-time posts, sales milestones, routine reviews, ordinary trailer promo, generic casting announcements, generic podcasts or dating-panel debate clips, local civic news, and low-information wrappers with no clear concrete event. Reality-TV and tabloid ecosystem scandal should almost never score high just because it is messy or scandalous; reality-show cast members and gossip-only personalities are not "creator drama" by default, and unless creator or streamer communities are plainly obsessed with it outside gossip media, it should usually stay under 25. Be strict: most stories should stay below 25, 45+ means likely Asmongold/penguinz0/Moon-style commentary bait today, and 60+ should be reserved for genuine internet storms. Return valid JSON with:
- boardVisibilityScore: 0-100. How strongly this should surface on the current board right now.
- moonFitScore: 0-100. How well the story fits Moon's channel.
- suggestedStoryType: one of normal, trending, controversy.
- controversyScore: 0-100. Rate actual backlash, scandal, conflict, outrage, or meaningful controversy.
- confidence: 0-100.
- explanation: one short sentence.`;
  }

  if (profile === "mens") {
    return `You score stories for Moon News' internal editorial board.

Your job is to decide whether the story deserves to surface on the board today. Moon's audience is mostly young, online, skeptical, disenfranchised men. Celebrity culture, pop culture, Hollywood, creator stories, internet culture, and platform stories are the top priority lanes. The best Moon stories feel important to young men right now and also open into a bigger point about society, status, power, media, tech, gender, money, dating, or institutional decay.

Start with the headline, then refine using the source evidence. A strong Moon story usually has at least two of these: high youth or internet interest, strong relevance to men online, real backlash or scandal, or a clear societal angle. Score high for creator drama, scams, platform abuse, masculinity or dating discourse, celebrity humiliation, pop-culture backlash, censorship, internet conflict, and system-rot stories that feel vivid and current. Keep routine politics, dry policy process, generic gossip, shopping, local incidents, and filler low. Return valid JSON with:
- boardVisibilityScore: 0-100. How strongly this should surface on the current board right now.
- moonFitScore: 0-100. How well the story fits Moon's channel.
- suggestedStoryType: one of normal, trending, controversy.
- controversyScore: 0-100. Rate actual backlash, scandal, conflict, outrage, or meaningful controversy.
- confidence: 0-100.
- explanation: one short sentence.`;
  }

  return `You score stories for Moon News' internal editorial board.

Your job is to decide whether the story deserves to surface on the board today.

Moon is not trying to be a general news feed. Reject most news.
Keep the small minority of stories that feel hot among young online men and can turn into a strong cultural thesis.
Moon's core lanes are celebrity culture, pop culture, Hollywood, online creators, commentators, podcasters, manosphere figures, internet culture, platform stories, and symbolic "this says something bigger about society" cases.

Return valid JSON with:
- boardVisibilityScore: 0-100. How strongly this should surface on the current board right now.
- moonFitScore: 0-100. How well the story fits Moon's channel.
- suggestedStoryType: one of normal, trending, controversy.
- controversyScore: 0-100. Rate actual backlash, scandal, conflict, outrage, or meaningful controversy.
- confidence: 0-100.
- explanation: one short sentence.

Rules:
- Start with the headline, then refine using the source evidence.
- Separate "moonFitScore" from "boardVisibilityScore". A story can fit Moon in theory but still be a weak board item today.
- Ask two questions:
  1. Would young online people actually care, click, argue, quote, or meme this right now?
  2. Does it open into a bigger point about culture, media, tech, status, masculinity, addiction, power, or institutional rot?
- High scores usually require both immediate attention pull and a larger read.
- A story can sound symbolic, scandalous, or institutionally important and still be a weak board story if ordinary young online people would not independently care.
- Do not give mid or high scores just because you can describe something as "institutional failure", "cultural reckoning", or "says something bigger". Those are supporting frames, not the primary reason to surface a story.
- Big themes alone are not enough. If the story lacks a concrete attention anchor such as a vivid clip, image, quote, leak, document, or a recognizable online-discourse character, keep it low.
- Broad traction should usually mean more than editorial repetition. If attention is mostly article coverage with no X, YouTube, Reddit, commentator, or competitor pickup, assume the story may still be trapped inside a media bubble and score conservatively.
- Use score bands aggressively:
  - 0-15: junk, broken headline, single-name / team-name / entity stub, quiz, deal, recap, how-to, SEO filler, or clearly irrelevant.
  - 20-30: mildly interesting, narrow-bubble, or follow-up churn. Not a board story.
  - 35-44: borderline watchlist material only. Use for stories with some angle but weak breadth, weak freshness, or weak escape from their native bubble.
  - 45-59: only when there is clear present-tense attention or controversy plus a sharper cultural angle and real evidence that the story has broken beyond one niche.
  - 60-74: obvious board candidate with real public reaction, discourse, or symbolic value.
  - 75+: top-tier board story. Use rarely.
- If the story lacks broad traction, lacks a larger read, or feels only moderately interesting, boardVisibilityScore should usually stay below 30.
- To score above 40, the story should usually have at least two real positives among: clear cross-platform pickup, a vivid artifact people are sharing, a recognizable figure who already exists as an online-discourse object outside a narrow beat or fandom, or a genuinely broad public reaction wave.
- One-source scandals, serious allegations, and morally shocking cases should still stay low unless the evidence shows real escape velocity into broader online culture.
- Strong positives: real backlash, scandal, humiliation, feuds, online discourse, memetic pull, creator / podcaster / commentator / manosphere drama, celebrity-pop culture-Hollywood stories with a darker or revealing angle, and platform or consumer stories that expose manipulation, addiction, monopoly behavior, class absurdity, or status games.
- Non-celebrity stories can still score high if they feel like a vivid proof-case of system failure that young people already feel in their lives: AI replacing humans and backfiring, platform lock-in, digital slop, labor absurdity, loneliness, dating-market distortion, addiction design, or everyday social decay.
- Some public-space, infrastructure, California, or elite-priority stories can score well when they become symbolic culture stories that people argue over, not just local policy news.
- Attention signals matter. If the story has clear cross-platform pickup, multiple-source momentum, quoteability, or clip potential, score it higher.
- Do not confuse repeated coverage inside one bubble with broad traction. Several tabloids, entertainment trades, partisan outlets, or same-lane aggregators repeating the same incident is still narrow coverage.
- Closed-loop coverage should stay low unless it clearly escapes its native bubble: political-media outrage, partisan culture-war packaging, reality-TV churn, franchise/fandom drama, and tabloid scandal updates are not enough on their own.
- Follow-up maintenance coverage should stay low: reactions, statements, responses, liveblogs, renamings, hearings, filming pauses, and second-day fallout are weak unless they introduce a major new artifact, leak, clip, or clear new reaction wave.
- Reality-franchise and tabloid-ecosystem stories should stay low even when scandalous if the figure mainly exists inside a show, cast, or gossip ecosystem and the incident has not clearly broken into broader online culture.
- A leaked clip, arrest report, or scandal allegation inside a reality-TV or franchise bubble is not automatically a strong board story. It still needs obvious escape velocity beyond entertainment coverage.
- If a story mostly matters to people who already follow that beat, franchise, or ideological lane, keep it low.
- Moon analog context is only a taste guide and tie-breaker. Do not mechanically force a score just because something resembles an old Moon title.
- Moon is not a general politics desk. Routine Trump coverage, war churn, ordinary party conflict, nominations, committee moves, sanctions, and dry policy process should score low.
- Routine politics, tax stories, bills, hearings, nominations, and policy arguments should almost never score above 25 unless they have become a major internet spectacle or clearly intersect with media, platform, creator, celebrity, or culture-war obsession.
- Speculative politics should score very low: "how will X change if Y happens", campaign strategy explainers, primary endorsements, polling, horse-race framing, party positioning, and future-policy what-if pieces are usually not board stories.
- Immigration, deportation, border, and DHS-process stories should stay low unless there is a vivid clip, leaked plan, mass public reaction, creator/commentator obsession, or an obvious everyday-life shock that young online people are already arguing about.
- Political stories should only score high when they escape politics and become a media spectacle, a corruption or surveillance story, a humiliation story, an obvious institutional-failure story, or a major internet obsession.
- Mainstream criminal-justice, court, policing, prosecution, and solemn public-affairs breaking news should usually stay low unless they clearly break into creator/commentator discourse, visible internet argument, or a sharper media/platform/system angle that young online people are actively reacting to.
- Geopolitics, national security, intelligence, cyberwar, sanctions, macroeconomics, Fed / rates, and foreign-conflict stories should usually stay low unless they clearly break into everyday online life, platform control, creator/media spectacle, youth anxiety, or a major public reaction cycle.
- A striking war clip or battlefield visual is not enough by itself. Foreign-conflict spectacle should usually stay low unless it becomes a broad online argument or connects directly to media manipulation, surveillance, platform control, or ordinary life.
- Surveillance or cyber stories should only score high when they feel personal and culturally alive: data brokers tracking ordinary people, platform abuse, censorship, AI manipulation, device surveillance, digital-rights panic, or a story lots of young online people would immediately argue about.
- Shallow gossip, after-party chatter, dating drama, outfits, Housewives-style maintenance gossip, and tabloid noise should score low unless they expose something darker or more culturally revealing.
- Generic celebrity gossip or reality-TV mess should stay low unless the figure is a real online-discourse object or the backlash is clearly large and quoteable.
- Distinguish between internet-native or commentator figures versus tabloid-only or franchise-only personalities. Stories about podcasters, streamers, commentators, culture-war figures, and major pop-culture names can score well; reality-TV ecosystem churn, Bachelor-style scandal, Mormon-wives / Housewives / TLC-style mess, and minor influencer drama should usually stay low unless they clearly break into broader online culture.
- Celebrity scandal is not enough by itself. If the figure is weakly known outside tabloid or franchise coverage, or the discourse is mostly outlet-driven rather than organic, score conservatively.
- Obituaries, death announcements, remembrance pieces, and tribute coverage should stay low unless the person is already a live internet-discourse object or the death is driving a broader meme, backlash, or cultural argument beyond routine remembrance.
- Historical-legacy takedowns, symbolic renamings, and icon-reassessment stories should stay low unless there is clearly fresh evidence and broad organic discourse beyond ideological or prestige-media packaging.
- Seriousness is not the same as board visibility. Abuse allegations, crime, war, and institutional wrongdoing should still score low when they remain niche, explanatory, or follow-up driven rather than alive in current online culture.
- Vague "viral" or "the internet reacts" framing should stay low unless there is a concrete image, clip, quote, product, or event that is visibly driving broad discussion.
- Do not reward the writer's framing more than the underlying event. Headlines that mainly package a reaction, explanation, or ideological angle should stay low if the underlying story is not independently hot.
- If the source evidence mainly consists of follow-up reaction stories, explanation pieces, or outlet-packaged "why everyone is talking about this" coverage, assume the underlying attention may be weaker than it sounds and score conservatively.
- Platform / tech / business updates should stay low unless they involve visible backlash, shutdown, failure, censorship, manipulation, slop, creator revolt, or something obviously symbolic about where society is going.
- Listicles, roundups, quizzes, one-day outrage bait, and topic packaging with no sharp case underneath should score low.
- Score low for routine filler: product launches, shopping/deals, sports fixtures, spoilers/recaps, casting news, trailer promo, streaming availability posts, isolated local incidents, missing-person oddities, and soft lifestyle content unless there is a much bigger angle.
- "Board visibility" is editorial usefulness plus likely attention for Moon right now, not abstract civic importance.
- Be decisive. Avoid middle-of-the-road scoring when the evidence is clear.`;
}

export async function classifyLine(input: {
  lineText: string;
  lineType: string;
  projectTitle: string;
  scriptContext?: string;
}): Promise<LineClassification> {
  const contextBlock = input.scriptContext
    ? `\n\nFull script context (the line marked >>> is the one to classify):\n${input.scriptContext}`
    : "";

  const response = await getOpenAIClient().responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `You classify documentary script lines for visual research. You will be given a single line to classify, along with surrounding script context so you understand what this section of the documentary is about.

Categories:
- concrete_event: A specific, dateable event (vote, attack, meeting, announcement)
- named_person: References a specific real person by name or title
- abstract_concept: Discusses patterns, trends, ideas without specific events
- quote_claim: Cites a specific document, memo, statement, or claim
- historical_period: References a broad historical era or timespan
- transition: Connective language between topics ("but the story doesn't end there")
- sample_story: Fictional or illustrative anecdote about a non-real person

Rules:
- search_keywords should be optimized for YouTube/video search (2-5 keywords)
- Include specific names, events, dates from the line AND surrounding context
- temporal_context should be a date range or era if detectable, null otherwise
- ai_generation_recommended should be true for: sample_story (always), abstract_concept (usually), transition (never needs visuals)
- ai_generation_reason explains WHY ai generation is recommended (null if not recommended)`,
      },
      {
        role: "user",
        content: `Project: "${input.projectTitle}"\nLine type: ${input.lineType}\nLine: "${input.lineText}"${contextBlock}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "line_classification",
        strict: true,
        schema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: [
                "concrete_event",
                "named_person",
                "abstract_concept",
                "quote_claim",
                "historical_period",
                "transition",
                "sample_story",
              ],
            },
            search_keywords: {
              type: "array",
              items: { type: "string" },
            },
            temporal_context: {
              type: ["string", "null"],
            },
            ai_generation_recommended: {
              type: "boolean",
            },
            ai_generation_reason: {
              type: ["string", "null"],
            },
          },
          required: [
            "category",
            "search_keywords",
            "temporal_context",
            "ai_generation_recommended",
            "ai_generation_reason",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const parsed = classificationSchema.parse(JSON.parse(response.output_text));
  return parsed;
}

// ─── AI Relevance Scoring ───

export async function scoreResultRelevance(input: {
  lineText: string;
  scriptContext?: string;
  results: Array<{
    title: string;
    description: string;
    provider: string;
  }>;
}): Promise<number[]> {
  if (input.results.length === 0) return [];

  const resultsText = input.results
    .map((r, i) => `${i + 1}. [${r.provider}] "${r.title}" — ${r.description.slice(0, 150)}`)
    .join("\n");

  const response = await getOpenAIClient().responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `You score search results for relevance to a documentary script line. For each result, return a relevance score 0-50 where:
- 40-50: Directly about the specific topic, event, or person mentioned
- 25-39: Related to the topic but not specifically about it
- 10-24: Tangentially related, could work as B-roll
- 0-9: Irrelevant, wrong topic, spam, or AI-generated filler

Be strict. A result about "CIA and media" is NOT relevant to "Operation Mockingbird" unless it specifically discusses Mockingbird. A random conspiracy video is NOT relevant just because it mentions the CIA.`,
      },
      {
        role: "user",
        content: `Script line: "${input.lineText}"${input.scriptContext ? `\n\nScript context:\n${input.scriptContext}` : ""}\n\nResults:\n${resultsText}\n\nReturn ONLY a JSON array of integers, one score per result. Example: [45, 30, 5, 40, 12]`,
      },
    ],
  });

  try {
    const scores = JSON.parse(response.output_text.trim());
    if (Array.isArray(scores) && scores.length === input.results.length) {
      return scores.map((s: unknown) => Math.max(0, Math.min(50, Number(s) || 0)));
    }
  } catch {
    // Fall through to default
  }

  // Default: position-based fallback
  return input.results.map((_, i) =>
    Math.max(20, 40 - Math.floor((i / input.results.length) * 20))
  );
}

const mediaSourceDecisionSchema = z.object({
  index: z.number().int().nonnegative(),
  shouldInclude: z.boolean(),
  isLikelySourceClip: z.boolean(),
  confidence: z.number().int().min(0).max(100),
  reason: z.string(),
});

type MediaSourceDecision = z.infer<typeof mediaSourceDecisionSchema>;

const mediaSourceDecisionResponseSchema = z.object({
  decisions: z.array(mediaSourceDecisionSchema),
});

export async function classifyMediaSourceCandidates(input: {
  query?: string;
  candidates: Array<{
    provider: string;
    title: string;
    channelOrContributor?: string | null;
    sourceUrl?: string | null;
  }>;
}): Promise<MediaSourceDecision[]> {
  if (input.candidates.length === 0) {
    return [];
  }

  const env = getEnv();
  const response = await getOpenAIClient().responses.create({
    model: env.OPENAI_MEDIA_SOURCE_MODEL,
    max_output_tokens: 2200,
    input: [
      {
        role: "system",
        content: `You decide whether a discovered video is a usable source clip for a documentary research system.

INCLUDE clips that are likely original/source material:
- official news segments from real news outlets
- original interview, podcast, appearance, speech, press conference, hearing, testimony, raw footage, or livestream uploads
- neutral reposts from unknown channels only when the title clearly indicates the underlying source clip itself

EXCLUDE clips that are likely commentary/wrappers:
- YouTubers talking about the topic
- reactions, explainers, essays, breakdowns, reviews, recaps, analysis videos
- topic-summary videos whose title mainly parrots the documentary angle instead of naming a source interview/show/news segment
- compilation videos unless they are clearly the canonical original show/network upload

Use ONLY the title, channel name, provider, and URL cues. Be conservative. If it looks like a person/channel covering the topic instead of being the underlying source artifact, exclude it.

Return strict JSON only.`,
      },
      {
        role: "user",
        content: [
          input.query ? `Topic query: ${input.query}` : null,
          "",
          "Candidates:",
          ...input.candidates.map((candidate, index) =>
            [
              `${index}. provider=${candidate.provider}`,
              `title=${candidate.title}`,
              `channel=${candidate.channelOrContributor ?? "unknown"}`,
              `url=${candidate.sourceUrl ?? "unknown"}`,
            ].join(" | ")
          ),
          "",
          "Return one decision per candidate with:",
          "- index",
          "- shouldInclude",
          "- isLikelySourceClip",
          "- confidence (0-100)",
          "- reason",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "media_source_decisions",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            decisions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  index: { type: "integer", minimum: 0 },
                  shouldInclude: { type: "boolean" },
                  isLikelySourceClip: { type: "boolean" },
                  confidence: { type: "integer", minimum: 0, maximum: 100 },
                  reason: { type: "string" },
                },
                required: [
                  "index",
                  "shouldInclude",
                  "isLikelySourceClip",
                  "confidence",
                  "reason",
                ],
              },
            },
          },
          required: ["decisions"],
        },
      },
    },
  });

  const parsed = mediaSourceDecisionResponseSchema.parse(JSON.parse(response.output_text));
  const decisionMap = new Map(parsed.decisions.map((decision) => [decision.index, decision]));

  return input.candidates.map(
    (_candidate, index) =>
      decisionMap.get(index) ?? {
        index,
        shouldInclude: true,
        isLikelySourceClip: false,
        confidence: 0,
        reason: "Missing model decision; defaulting to include.",
      }
  );
}

// ─── Board Story Assessment ───

export async function assessBoardStory(input: {
  canonicalTitle: string;
  vertical: string | null;
  currentStoryType: string;
  lastSeenAt: string | null;
  itemsCount: number;
  sourcesCount: number;
  observedControversyScore?: number | null;
  attentionSignals?: {
    hasXDiscourse: boolean;
    hasTikTokPickup: boolean;
    hasYouTubePickup: boolean;
    hasRedditPickup: boolean;
    hasMultipleSources: boolean;
    competitorOverlap: number | null;
    visualEvidence: number | null;
    xPostCount?: number | null;
    xHighEngagementPostCount?: number | null;
    xVideoPostCount?: number | null;
    xHighEngagementVideoPostCount?: number | null;
    xOutlierPostCount?: number | null;
    xStrongOutlierPostCount?: number | null;
    maxXOutlierRatio?: number | null;
    tiktokPostCount?: number | null;
    tiktokHighEngagementPostCount?: number | null;
    tiktokVideoPostCount?: number | null;
    tiktokOutlierPostCount?: number | null;
    tiktokStrongOutlierPostCount?: number | null;
    maxTikTokOutlierRatio?: number | null;
    aggregateViewCount?: number | null;
    maxViewCount?: number | null;
    aggregateLikeCount?: number | null;
    aggregateRetweetCount?: number | null;
    backlashSourceCount?: number | null;
    reactionSourceCount?: number | null;
    institutionalSpectacleSourceCount?: number | null;
  } | null;
  moonContext?: {
    clusterLabel: string | null;
    coverageMode: string | null;
    analogMedianViews: number | null;
    analogs: Array<{
      title: string;
      viewCount: number | null;
      similarityScore: number;
    }>;
  } | null;
  sources: Array<{
    sourceName: string;
    sourceKind: string;
    title: string;
    summary: string | null;
    hasVideo?: boolean | null;
    videoDescription?: string | null;
    viewOutlierRatio?: number | null;
    maxOutlierRatio?: number | null;
    publishedAt: string | null;
    viewCount?: number | null;
    likeCount?: number | null;
    retweetCount?: number | null;
  }>;
  promptProfile?: BoardScoringPromptProfile | null;
}): Promise<BoardStoryAssessment> {
  const env = getEnv();
  const promptProfile = input.promptProfile ?? "default";
  const formatViews = (value: number | null | undefined) => {
    if (!value || value <= 0) return "n/a";
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
    return String(value);
  };
  const formatRatio = (value: number | null | undefined) =>
    value && value > 0 ? `${value.toFixed(value >= 10 ? 0 : 1)}x` : "n/a";
  const sourceBlock = input.sources
    .slice(0, 6)
    .map((source, index) =>
      [
        `${index + 1}. ${source.sourceName} [${source.sourceKind}]`,
        `Title: ${source.title}`,
        source.publishedAt ? `Published: ${source.publishedAt}` : null,
        source.hasVideo ? "Attached clip: yes" : null,
        source.videoDescription ? `Clip details: ${source.videoDescription}` : null,
        source.maxOutlierRatio
          ? `Account-relative outlier: ${formatRatio(source.maxOutlierRatio)} typical engagement${source.viewOutlierRatio ? ` (${formatRatio(source.viewOutlierRatio)} typical views)` : ""}`
          : null,
        source.viewCount || source.likeCount || source.retweetCount
          ? `Engagement: ${formatViews(source.viewCount)} views / ${formatViews(source.likeCount)} likes / ${formatViews(source.retweetCount)} reposts`
          : null,
        source.summary ? `Summary: ${source.summary}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
  const analogBlock =
    input.moonContext?.analogs && input.moonContext.analogs.length > 0
      ? input.moonContext.analogs
          .slice(0, 3)
          .map(
            (analog, index) =>
              `${index + 1}. ${analog.title} (${formatViews(analog.viewCount)} views, similarity ${analog.similarityScore.toFixed(2)})`
          )
          .join("\n")
      : "No close Moon analogs found.";

  const response = await getOpenAIClient().responses.create({
    model: env.OPENAI_RESEARCH_MODEL,
    input: [
      {
        role: "system",
        content: buildBoardStoryAssessmentSystemPrompt(promptProfile),
      },
      {
        role: "user",
        content: [
          `Story: ${input.canonicalTitle}`,
          input.vertical ? `Vertical: ${input.vertical}` : "Vertical: unknown",
          `Current type: ${input.currentStoryType}`,
          input.lastSeenAt ? `Last seen: ${input.lastSeenAt}` : "Last seen: unknown",
          `Evidence counts: ${input.sourcesCount} sources / ${input.itemsCount} items`,
          input.observedControversyScore !== undefined && input.observedControversyScore !== null
            ? `Observed controversy signal: ${input.observedControversyScore}/100`
            : "Observed controversy signal: unknown",
          input.attentionSignals
            ? `Attention signals: X discourse ${input.attentionSignals.hasXDiscourse ? "yes" : "no"}; TikTok pickup ${input.attentionSignals.hasTikTokPickup ? "yes" : "no"}; YouTube pickup ${input.attentionSignals.hasYouTubePickup ? "yes" : "no"}; Reddit pickup ${input.attentionSignals.hasRedditPickup ? "yes" : "no"}; multiple sources ${input.attentionSignals.hasMultipleSources ? "yes" : "no"}; competitor overlap ${input.attentionSignals.competitorOverlap ?? 0}; visual evidence ${input.attentionSignals.visualEvidence ?? 0}; X posts ${input.attentionSignals.xPostCount ?? 0}; high-engagement X posts ${input.attentionSignals.xHighEngagementPostCount ?? 0}; X clip posts ${input.attentionSignals.xVideoPostCount ?? 0}; high-engagement X clip posts ${input.attentionSignals.xHighEngagementVideoPostCount ?? 0}; X outlier posts ${input.attentionSignals.xOutlierPostCount ?? 0}; strong X outlier posts ${input.attentionSignals.xStrongOutlierPostCount ?? 0}; max X outlier ratio ${formatRatio(input.attentionSignals.maxXOutlierRatio)}; TikTok posts ${input.attentionSignals.tiktokPostCount ?? 0}; high-engagement TikTok posts ${input.attentionSignals.tiktokHighEngagementPostCount ?? 0}; TikTok clip posts ${input.attentionSignals.tiktokVideoPostCount ?? 0}; TikTok outlier posts ${input.attentionSignals.tiktokOutlierPostCount ?? 0}; strong TikTok outlier posts ${input.attentionSignals.tiktokStrongOutlierPostCount ?? 0}; max TikTok outlier ratio ${formatRatio(input.attentionSignals.maxTikTokOutlierRatio)}; aggregate views ${formatViews(input.attentionSignals.aggregateViewCount)}; max single-post views ${formatViews(input.attentionSignals.maxViewCount)}; aggregate likes ${formatViews(input.attentionSignals.aggregateLikeCount)}; aggregate reposts ${formatViews(input.attentionSignals.aggregateRetweetCount)}; backlash sources ${input.attentionSignals.backlashSourceCount ?? 0}; reaction sources ${input.attentionSignals.reactionSourceCount ?? 0}; institutional spectacle sources ${input.attentionSignals.institutionalSpectacleSourceCount ?? 0}`
            : "Attention signals: unknown",
          input.moonContext?.clusterLabel
            ? `Closest Moon lane: ${input.moonContext.clusterLabel}${input.moonContext.coverageMode ? ` / ${input.moonContext.coverageMode}` : ""}`
            : "Closest Moon lane: unknown",
          input.moonContext
            ? `Moon analog median views: ${formatViews(input.moonContext.analogMedianViews)}`
            : "Moon analog median views: unknown",
          "",
          "Closest Moon analogs:",
          analogBlock,
          "",
          "Sources:",
          sourceBlock || "No sources available.",
        ].join("\n"),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "board_story_assessment",
        strict: true,
        schema: {
          type: "object",
          properties: {
            boardVisibilityScore: { type: "integer", minimum: 0, maximum: 100 },
            moonFitScore: { type: "integer", minimum: 0, maximum: 100 },
            suggestedStoryType: {
              type: "string",
              enum: ["normal", "trending", "controversy"],
            },
            controversyScore: { type: "integer", minimum: 0, maximum: 100 },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            explanation: { type: "string" },
          },
          required: [
            "boardVisibilityScore",
            "moonFitScore",
            "suggestedStoryType",
            "controversyScore",
            "confidence",
            "explanation",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  return boardStoryAssessmentSchema.parse(JSON.parse(response.output_text));
}

export async function analyzeBoardStoryComments(input: {
  storyTitle: string;
  comments: Array<{
    sourceTitle: string;
    sourceUrl: string;
    author: string;
    text: string;
    likeCount: number;
  }>;
}): Promise<{
  model: string;
  reaction: BoardCommentReaction;
}> {
  const env = getEnv();
  const model = env.OPENAI_TRANSCRIPT_SCAN_MODEL;
  const trimmedComments = input.comments
    .map((comment) => ({
      ...comment,
      text: comment.text.replace(/\s+/g, " ").trim().slice(0, 420),
    }))
    .filter((comment) => comment.text.length > 0)
    .slice(0, 16);

  if (trimmedComments.length === 0) {
    return {
      model,
      reaction: {
        overallTone: "mixed",
        intensity: "muted",
        summary: "No usable comments were available to analyze.",
        keyThemes: [],
        standoutCommentIndexes: [],
      },
    };
  }

  const response = await getOpenAIClient().responses.create({
    model,
    max_output_tokens: 1000,
    input: [
      {
        role: "system",
        content:
          "You analyze audience reaction from top public comments on a story. Be concrete, concise, and faithful to the comments. Return strict JSON only.",
      },
      {
        role: "user",
        content: [
          `Story title: ${input.storyTitle}`,
          "",
          "Comments:",
          ...trimmedComments.map((comment, index) =>
            [
              `${index}. Source: ${comment.sourceTitle}`,
              `Author: ${comment.author}`,
              `Likes: ${comment.likeCount}`,
              `URL: ${comment.sourceUrl}`,
              `Text: ${comment.text}`,
            ].join("\n")
          ),
          "",
          "Summarize the actual audience reaction. Prefer themes like disbelief, mockery, fear, praise, confusion, or backlash. Select the strongest 2-4 comment indexes worth surfacing in the board UI.",
        ].join("\n\n"),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "board_comment_reaction",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            overallTone: {
              type: "string",
              enum: [
                "skeptical",
                "mocking",
                "angry",
                "concerned",
                "impressed",
                "confused",
                "mixed",
              ],
            },
            intensity: {
              type: "string",
              enum: ["muted", "active", "loud", "frenzy"],
            },
            summary: { type: "string" },
            keyThemes: {
              type: "array",
              items: { type: "string" },
              maxItems: 5,
            },
            standoutCommentIndexes: {
              type: "array",
              items: {
                type: "integer",
                minimum: 0,
                maximum: 15,
              },
              maxItems: 4,
            },
          },
          required: [
            "overallTone",
            "intensity",
            "summary",
            "keyThemes",
            "standoutCommentIndexes",
          ],
        },
      },
    },
  });

  return {
    model,
    reaction: boardCommentReactionSchema.parse(
      parseLooseJson(response.output_text ?? "{}")
    ),
  };
}

export async function chooseMatchingBoardStory(input: {
  item: {
    title: string;
    summary: string | null;
    publishedAt: string | null;
    url: string;
  };
  candidates: Array<{
    id: string;
    canonicalTitle: string;
    vertical: string | null;
    storyType: string;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    itemsCount: number;
    sourcesCount: number;
    heuristicScore: number;
  }>;
}): Promise<BoardStoryDedupDecision> {
  const env = getEnv();
  const candidateBlock = input.candidates
    .map((candidate, index) =>
      [
        `${index + 1}. id=${candidate.id}`,
        `Title: ${candidate.canonicalTitle}`,
        candidate.vertical ? `Vertical: ${candidate.vertical}` : null,
        `Type: ${candidate.storyType}`,
        candidate.firstSeenAt ? `First seen: ${candidate.firstSeenAt}` : null,
        candidate.lastSeenAt ? `Last seen: ${candidate.lastSeenAt}` : null,
        `Evidence: ${candidate.sourcesCount} sources / ${candidate.itemsCount} items`,
        `Heuristic score: ${candidate.heuristicScore.toFixed(2)}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  const response = await getOpenAIClient().responses.create({
    model: env.OPENAI_STORY_DEDUP_MODEL,
    max_output_tokens: 160,
    input: [
      {
        role: "system",
        content: `You decide whether one incoming feed item is the same underlying story as one of several candidate story clusters.

Same company, same celebrity, or same broad topic is not enough. Match only if it is the same concrete event, artifact, controversy, verdict, trailer, patch, rollout, leak, ban, clip, scandal, or reaction wave.

Good matches:
- the same jury verdict described by different outlets
- the same trailer drop and backlash around that trailer
- the same platform rollout and backlash around that rollout

Bad matches:
- two different lawsuits involving the same company
- two different AI incidents involving the same company
- a general analysis article about a topic versus a specific breaking event

Be conservative. If none of the candidates are clearly the same underlying story, return sameStory=false and matchStoryId=null.

Return strict JSON only.`,
      },
      {
        role: "user",
        content: [
          "Incoming item:",
          `Title: ${input.item.title}`,
          input.item.publishedAt ? `Published: ${input.item.publishedAt}` : null,
          `URL: ${input.item.url}`,
          input.item.summary ? `Summary: ${input.item.summary}` : null,
          "",
          "Candidate story clusters:",
          candidateBlock || "No candidates.",
          "",
          "Return:",
          "- matchStoryId: exact candidate id string, or null",
          "- sameStory: boolean",
          "- confidence: 0-100",
          "- explanation: one short sentence",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "board_story_dedup_decision",
        strict: true,
        schema: {
          type: "object",
          properties: {
            matchStoryId: {
              anyOf: [{ type: "string" }, { type: "null" }],
            },
            sameStory: { type: "boolean" },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            explanation: { type: "string" },
          },
          required: ["matchStoryId", "sameStory", "confidence", "explanation"],
          additionalProperties: false,
        },
      },
    },
  });

  const parsed = boardStoryDedupDecisionSchema.parse(JSON.parse(response.output_text));

  if (!parsed.sameStory) {
    return {
      ...parsed,
      matchStoryId: null,
    };
  }

  return parsed;
}

// ─── Transcript Quote Extraction ───

export interface ExtractedQuote {
  quoteText: string;
  speaker: string | null;
  startMs: number;
  endMs: number;
  relevanceScore: number;
  context: string;
}

export async function findRelevantQuotes(input: {
  lineText: string;
  transcript: Array<{ text: string; startMs: number; durationMs: number }>;
  videoTitle: string;
  maxQuotes?: number;
  scriptContext?: string;
}): Promise<ExtractedQuote[]> {
  if (input.transcript.length === 0) return [];
  const env = getEnv();

  const normalizeForSearch = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9'\s]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const STOPWORDS = new Set([
    "the", "and", "that", "with", "from", "they", "them", "this", "were", "what", "when", "would",
    "there", "their", "into", "about", "have", "been", "just", "even", "very", "much", "more",
    "than", "then", "onto", "show", "live", "line", "said", "asked", "went", "kept", "still",
    "like", "your", "before", "after", "years", "time", "public", "world", "hosts",
  ]);

  const quotedFragments = Array.from(
    input.lineText.matchAll(/[“"']([^“"'”]{3,90})[”"']/g),
    (match) => normalizeForSearch(match[1] ?? ""),
  ).filter(Boolean);

  const titleCasePhrases = Array.from(
    input.lineText.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g),
    (match) => normalizeForSearch(match[1] ?? ""),
  ).filter(Boolean);

  const keywordTokens = normalizeForSearch(input.lineText)
    .split(" ")
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));

  const lineAnchors = Array.from(
    new Set([
      ...quotedFragments,
      ...titleCasePhrases,
      ...keywordTokens,
    ]),
  ).sort((left, right) => right.length - left.length);

  type CandidateWindow = {
    startIndex: number;
    endIndex: number;
    startMs: number;
    endMs: number;
    text: string;
    anchorScore: number;
  };

  const scoreTextAgainstAnchors = (text: string) => {
    const normalized = normalizeForSearch(text);
    let score = 0;
    for (const anchor of lineAnchors) {
      if (!anchor) continue;
      if (anchor.includes(" ")) {
        if (normalized.includes(anchor)) score += Math.min(anchor.split(" ").length * 8, 24);
      } else if (normalized.includes(anchor)) {
        score += 4;
      }
    }
    return score;
  };

  const candidateWindows: CandidateWindow[] = [];
  for (let i = 0; i < input.transcript.length; i += 1) {
    const slice = input.transcript.slice(Math.max(0, i - 1), Math.min(input.transcript.length, i + 3));
    const startIndex = Math.max(0, i - 1);
    const endIndex = Math.min(input.transcript.length - 1, i + 2);
    const text = slice.map((seg) => seg.text).join(" ").trim();
    const anchorScore = scoreTextAgainstAnchors(text);
    if (anchorScore <= 0) continue;
    candidateWindows.push({
      startIndex,
      endIndex,
      startMs: input.transcript[startIndex]?.startMs ?? input.transcript[i]?.startMs ?? 0,
      endMs:
        (input.transcript[endIndex]?.startMs ?? 0) +
        (input.transcript[endIndex]?.durationMs ?? 0),
      text,
      anchorScore,
    });
  }

  const dedupedCandidates = Array.from(
    new Map(
      candidateWindows
        .sort((a, b) => b.anchorScore - a.anchorScore || a.startMs - b.startMs)
        .map((item) => [`${item.startIndex}:${item.endIndex}`, item]),
    ).values(),
  ).slice(0, 10);

  const fallbackBlocks: Array<{ text: string; startMs: number; endMs: number }> = [];
  let currentBlock = { text: "", startMs: 0, endMs: 0 };
  for (const seg of input.transcript) {
    if (!currentBlock.text) {
      currentBlock = {
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.startMs + seg.durationMs,
      };
    } else if (seg.startMs - currentBlock.startMs < 20000) {
      currentBlock.text += " " + seg.text;
      currentBlock.endMs = seg.startMs + seg.durationMs;
    } else {
      fallbackBlocks.push(currentBlock);
      currentBlock = {
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.startMs + seg.durationMs,
      };
    }
  }
  if (currentBlock.text) fallbackBlocks.push(currentBlock);

  const windowsToScan =
    dedupedCandidates.length > 0
      ? dedupedCandidates.map((item) => ({
          text: item.text,
          startMs: item.startMs,
          endMs: item.endMs,
          anchorScore: item.anchorScore,
        }))
      : fallbackBlocks.map((item) => ({
          text: item.text,
          startMs: item.startMs,
          endMs: item.endMs,
          anchorScore: 0,
        }));

  const transcriptText = windowsToScan
    .map((b) => {
      const mins = Math.floor(b.startMs / 60000);
      const secs = Math.floor((b.startMs % 60000) / 1000);
      const endMins = Math.floor(b.endMs / 60000);
      const endSecs = Math.floor((b.endMs % 60000) / 1000);
      const scoreLabel = b.anchorScore > 0 ? ` score=${b.anchorScore}` : "";
      return `[${mins}:${String(secs).padStart(2, "0")}-${endMins}:${String(endSecs).padStart(2, "0")}${scoreLabel}] ${b.text}`;
    })
    .join("\n")
    .slice(0, 30000);

  const maxQuotes = input.maxQuotes ?? 5;
  const systemPrompt = `You extract the most relevant quotes from interview/video transcripts for a documentary editor. You'll be given a specific script line, the full editorial angle for the video, surrounding script context, and candidate timestamped transcript windows. Find quotes that:
- Directly support, illustrate, or provide evidence for the script line's claim
- Are spoken clearly and would work as a clip in a documentary
- Have strong emotional or factual weight
- Connect to the broader documentary thesis shown in the script context
- Prefer the central speaker's own words over narration or recap
- Stay tightly focused on the line's actual wording and subject, not just the general topic
- May span multiple consecutive transcript blocks if the thought remains coherent
- Can be long when justified, but do NOT include generic intro/setup material before the quote

CRITICAL RULES:
1. quoteText MUST be copied VERBATIM from the transcript — do not paraphrase, summarize, or reword
2. startMs MUST match the timestamp of the first candidate window containing the quote
3. If you cannot find a relevant verbatim quote in the transcript, return an empty array
4. Only return quotes that actually appear in the provided transcript text
5. Prefer complete thoughts over short fragments. Do not cut a quote off mid-thought unless the transcript itself is broken.
6. A single quote may be long if it remains coherent, but must stay under 140 words.
7. Reject weak topical matches. If the line is about "murderers", "shut up", or "manslaughter", the returned quote should clearly contain or directly support that exact moment.

Return ONLY a JSON object with a single key "quotes".

The value of "quotes" must be an array of objects with:
- quoteText: VERBATIM text copied directly from the transcript
- speaker: who is speaking (name if identifiable from context, null if unclear)
- startMs: timestamp in milliseconds — MUST match a timestamp from the transcript
- endMs: timestamp where it ends (startMs + estimated duration)
- relevanceScore: 0-100 how relevant to the script line
- context: one sentence explaining why this quote matters for the documentary

Return at most ${maxQuotes} quotes, sorted by relevance. If nothing relevant, return {"quotes":[]}.`;
  const userPrompt = `Script line: "${input.lineText}"${input.scriptContext ? `\n\nEditorial angle and script context:\n${input.scriptContext}` : ""}\n\nStrong anchor phrases from the line:\n${lineAnchors.slice(0, 12).map((anchor) => `- ${anchor}`).join("\n") || "- none"}\n\nVideo: "${input.videoTitle}"\n\nCandidate transcript windows:\n${transcriptText}`;

  const response = await getOpenAIClient().responses.create({
    model: env.OPENAI_QUOTE_EXTRACTION_MODEL,
    max_output_tokens: 2800,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "relevant_quotes",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            quotes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  quoteText: { type: "string" },
                  speaker: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },
                  startMs: { type: "number" },
                  endMs: { type: "number" },
                  relevanceScore: { type: "number" },
                  context: { type: "string" },
                },
                required: [
                  "quoteText",
                  "speaker",
                  "startMs",
                  "endMs",
                  "relevanceScore",
                  "context",
                ],
              },
            },
          },
          required: ["quotes"],
        },
      },
    },
  });
  const outputText = response.output_text;

  try {
    const jsonMatch = outputText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const parsedQuotes = Array.isArray(parsed?.quotes) ? parsed.quotes : [];

    const rawQuotes: Array<{
      quoteText: string;
      speaker: string | null;
      startMs: number;
      endMs: number;
      relevanceScore: number;
      context: string;
    }> = parsedQuotes
      .filter(
        (q: Record<string, unknown>) =>
          q.quoteText && typeof q.startMs === "number"
      )
      .map((q: Record<string, unknown>) => ({
        quoteText: String(q.quoteText),
        speaker: q.speaker ? String(q.speaker) : null,
        startMs: Number(q.startMs),
        endMs: Number(q.endMs ?? Number(q.startMs) + 10000),
        relevanceScore: Math.max(0, Math.min(100, Number(q.relevanceScore ?? 50))),
        context: String(q.context ?? ""),
      }))
      .slice(0, maxQuotes);

    // Post-process: verify each quote exists in the transcript
    // and correct its timestamp by searching across short consecutive windows
    const verified: typeof rawQuotes = [];

    const windowSize = 6;
    const windows: Array<{ text: string; startMs: number; endMs: number; startIndex: number; endIndex: number }> = [];
    for (let i = 0; i < input.transcript.length; i++) {
      const slice = input.transcript.slice(i, i + windowSize);
      windows.push({
        text: normalizeForSearch(slice.map((s) => s.text).join(" ")),
        startMs: input.transcript[i].startMs,
        endMs:
          (slice[slice.length - 1]?.startMs ?? input.transcript[i].startMs) +
          (slice[slice.length - 1]?.durationMs ?? 0),
        startIndex: i,
        endIndex: Math.min(input.transcript.length - 1, i + windowSize - 1),
      });
    }

    for (const quote of rawQuotes) {
      const normalizedQuote = normalizeForSearch(quote.quoteText);
      if (!normalizedQuote || normalizedQuote.split(/\s+/).length < 4) continue;
      const lineOverlap = lineAnchors.filter((anchor) => normalizedQuote.includes(anchor)).length;
      if (lineAnchors.length > 0 && lineOverlap === 0) {
        continue;
      }

      let matchWindow:
        | { text: string; startMs: number; endMs: number; startIndex: number; endIndex: number }
        | undefined;

      matchWindow = windows.find((window) => window.text.includes(normalizedQuote));
      if (!matchWindow) {
        const quoteTokens = normalizedQuote.split(/\s+/).filter(Boolean);
        const tokenProbe = quoteTokens.slice(0, Math.min(8, quoteTokens.length)).join(" ");
        if (tokenProbe.length >= 12) {
          matchWindow = windows.find((window) => window.text.includes(tokenProbe));
        }
      }
      if (!matchWindow) continue;

      let bestExactSpan:
        | { text: string; startMs: number; endMs: number; wordCount: number }
        | null = null;
      for (let start = matchWindow.startIndex; start <= matchWindow.endIndex; start += 1) {
        for (let end = start; end <= Math.min(matchWindow.endIndex, start + 3); end += 1) {
          const spanText = input.transcript
            .slice(start, end + 1)
            .map((segment) => segment.text)
            .join(" ")
            .trim();
          const normalizedSpan = normalizeForSearch(spanText);
          if (!normalizedSpan.includes(normalizedQuote)) continue;
          const wordCount = spanText.split(/\s+/).filter(Boolean).length;
          const span = {
            text: spanText,
            startMs: input.transcript[start]?.startMs ?? matchWindow.startMs,
            endMs:
              (input.transcript[end]?.startMs ?? matchWindow.endMs) +
              (input.transcript[end]?.durationMs ?? 0),
            wordCount,
          };
          if (!bestExactSpan || span.wordCount < bestExactSpan.wordCount) {
            bestExactSpan = span;
          }
        }
      }

      if (!bestExactSpan) {
        continue;
      }

      quote.startMs = bestExactSpan.startMs;
      quote.endMs = bestExactSpan.endMs;
      quote.quoteText = bestExactSpan.text;
      verified.push(quote);
    }

    return verified.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, maxQuotes);
  } catch {
    return [];
  }
}

export interface MissionScanTalkingPoint {
  label: string;
  quoteText: string;
  speaker: string | null;
  startMs: number;
  endMs: number;
  relevanceScore: number;
  whyRelevant: string;
  matchedSectionHeadings: string[];
  topics: string[];
}

export async function scanTranscriptForMission(input: {
  missionTitle: string;
  missionObjective: string;
  missionInstructions?: string[];
  keywordHints?: string[];
  sectionHeadings?: string[];
  sectionGuidance?: Array<{
    heading: string;
    mission: string;
    lookFor: string[];
  }>;
  transcript: Array<{ text: string; startMs: number; durationMs: number }>;
  videoTitle: string;
  maxPointsPerChunk?: number;
}): Promise<{
  model: string;
  summary: string;
  talkingPoints: MissionScanTalkingPoint[];
}> {
  if (input.transcript.length === 0) {
    return {
      model: getEnv().OPENAI_TRANSCRIPT_SCAN_MODEL,
      summary: "No transcript available.",
      talkingPoints: [],
    };
  }

  const env = getEnv();
  const maxPointsPerChunk = Math.max(1, Math.min(8, input.maxPointsPerChunk ?? 5));

  const blocks: Array<{ text: string; startMs: number }> = [];
  let currentBlock = { text: "", startMs: 0 };
  for (const seg of input.transcript) {
    if (!currentBlock.text) {
      currentBlock = { text: seg.text, startMs: seg.startMs };
    } else if (seg.startMs - currentBlock.startMs < 60000) {
      currentBlock.text += ` ${seg.text}`;
    } else {
      blocks.push(currentBlock);
      currentBlock = { text: seg.text, startMs: seg.startMs };
    }
  }
  if (currentBlock.text) {
    blocks.push(currentBlock);
  }

  const transcriptChunks: Array<{ text: string; startMs: number }> = [];
  let chunkText = "";
  let chunkStartMs = 0;
  for (const block of blocks) {
    const mins = Math.floor(block.startMs / 60000);
    const secs = Math.floor((block.startMs % 60000) / 1000);
    const line = `[${mins}:${String(secs).padStart(2, "0")}] ${block.text}`.trim();

    if (!chunkText) {
      chunkText = line;
      chunkStartMs = block.startMs;
      continue;
    }

    if (chunkText.length + line.length + 1 <= 12000) {
      chunkText += `\n${line}`;
      continue;
    }

    transcriptChunks.push({ text: chunkText, startMs: chunkStartMs });
    chunkText = line;
    chunkStartMs = block.startMs;
  }
  if (chunkText) {
    transcriptChunks.push({ text: chunkText, startMs: chunkStartMs });
  }

  const normalizedHints = (input.keywordHints ?? [])
    .map((hint) => hint.trim().toLowerCase())
    .filter((hint) => hint.length >= 3);
  const chunkIndexesToScan =
    normalizedHints.length > 0
      ? Array.from(
          new Set(
            transcriptChunks.flatMap((chunk, index) => {
              const lowerText = chunk.text.toLowerCase();
              if (!normalizedHints.some((hint) => lowerText.includes(hint))) {
                return [];
              }
              return [Math.max(0, index - 1), index, Math.min(transcriptChunks.length - 1, index + 1)];
            })
          )
        ).sort((left, right) => left - right)
      : [];
  const chunksToScan =
    chunkIndexesToScan.length > 0
      ? chunkIndexesToScan.map((index) => transcriptChunks[index])
      : transcriptChunks;

  type RawTalkingPoint = {
    label: string;
    quoteText: string;
    speaker: string | null;
    startMs: number;
    endMs: number;
    relevanceScore: number;
    whyRelevant: string;
    matchedSectionHeadings: string[];
    topics: string[];
  };

  const systemPrompt = `You are scanning a video transcript for documentary research.

You will receive:
- a transcript mission created by a story planner
- the video's title
- the allowed documentary section headings
- one chunk of a transcript

Your job is to pull every clearly relevant talking point from the chunk that could matter for the story mission.

What counts as relevant:
- direct claims, explanations, predictions, warnings, comparisons, or admissions tied to the mission
- concrete descriptions of demos, policy, capability limits, labor effects, manufacturing claims, geopolitical framing, or state symbolism when relevant
- strong documentary-ready passages said plainly by the speaker
- passages that would clearly help write one of the provided documentary sections, even if the connection is indirect but real

What does NOT count:
- generic filler, sponsor talk, intros, housekeeping, unrelated biography, repeated banter, or broad AI talk with no mission relevance
- commentary about the clip that does not add new evidence or framing relevant to the mission

Rules:
1. quoteText must be copied VERBATIM from the transcript chunk
2. Prefer whole coherent thoughts instead of tiny fragments
3. A talking point may be one or two consecutive transcript blocks, but keep it under 220 words
4. matchedSectionHeadings must only use headings from the provided allowed list
5. If the chunk has nothing relevant, return { "chunkSummary": "...", "talkingPoints": [] }
6. Return strict JSON only`;

  const rawPoints: RawTalkingPoint[] = [];

  for (const chunk of chunksToScan) {
    const userPrompt = [
      `Mission title: ${input.missionTitle}`,
      `Mission objective: ${input.missionObjective}`,
      input.missionInstructions?.length
        ? `Mission instructions:\n- ${input.missionInstructions.join("\n- ")}`
        : null,
      input.sectionHeadings?.length
        ? `Allowed section headings:\n- ${input.sectionHeadings.join("\n- ")}`
        : "Allowed section headings:\n- none provided",
      input.sectionGuidance?.length
        ? `Section guidance:\n${input.sectionGuidance
            .map((section) =>
              [
                `Heading: ${section.heading}`,
                `Mission: ${section.mission}`,
                section.lookFor.length ? `Look for: ${section.lookFor.join(" | ")}` : null,
              ]
                .filter(Boolean)
                .join("\n")
            )
            .join("\n\n")}`
        : null,
      `Video: ${input.videoTitle}`,
      "",
      "Transcript chunk:",
      chunk.text,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await getOpenAIClient().responses.create({
      model: env.OPENAI_TRANSCRIPT_SCAN_MODEL,
      max_output_tokens: 2200,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "transcript_mission_scan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              chunkSummary: { type: "string" },
              talkingPoints: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    label: { type: "string" },
                    quoteText: { type: "string" },
                    speaker: { anyOf: [{ type: "string" }, { type: "null" }] },
                    startMs: { type: "number" },
                    endMs: { type: "number" },
                    relevanceScore: { type: "number" },
                    whyRelevant: { type: "string" },
                    matchedSectionHeadings: {
                      type: "array",
                      items: { type: "string" },
                    },
                    topics: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: [
                    "label",
                    "quoteText",
                    "speaker",
                    "startMs",
                    "endMs",
                    "relevanceScore",
                    "whyRelevant",
                    "matchedSectionHeadings",
                    "topics",
                  ],
                },
              },
            },
            required: ["chunkSummary", "talkingPoints"],
          },
        },
      },
    });

    const parsed = parseLooseJson(response.output_text) as {
      talkingPoints?: RawTalkingPoint[];
    };

    for (const point of parsed.talkingPoints ?? []) {
      rawPoints.push({
        label: String(point.label ?? "Relevant moment"),
        quoteText: String(point.quoteText ?? ""),
        speaker: typeof point.speaker === "string" ? point.speaker : null,
        startMs: Number(point.startMs ?? chunk.startMs),
        endMs: Number(point.endMs ?? Number(point.startMs ?? chunk.startMs) + 10000),
        relevanceScore: Math.max(0, Math.min(100, Number(point.relevanceScore ?? 50))),
        whyRelevant: String(point.whyRelevant ?? ""),
        matchedSectionHeadings: Array.isArray(point.matchedSectionHeadings)
          ? point.matchedSectionHeadings
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
        topics: Array.isArray(point.topics)
          ? point.topics
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
      });
    }
  }

  const windows: Array<{ text: string; startMs: number }> = [];
  const windowSize = 30;
  for (let i = 0; i < input.transcript.length; i += 1) {
    const slice = input.transcript.slice(i, i + windowSize);
    windows.push({
      text: slice.map((segment) => segment.text).join(" ").toLowerCase(),
      startMs: input.transcript[i].startMs,
    });
  }

  const verified: MissionScanTalkingPoint[] = [];
  for (const point of rawPoints) {
    const lowerQuote = point.quoteText.toLowerCase();
    if (!lowerQuote.trim()) {
      continue;
    }

    const searchTerms: string[] = [];
    for (const len of [40, 25, 15]) {
      const prefix = lowerQuote.slice(0, len);
      if (prefix.length >= 10) {
        searchTerms.push(prefix);
      }
    }
    const words = lowerQuote.split(/\s+/);
    for (let index = 0; index < words.length - 3; index += 3) {
      const phrase = words.slice(index, index + 4).join(" ");
      if (phrase.length >= 10) {
        searchTerms.push(phrase);
      }
    }

    let matched = false;
    for (const searchTerm of searchTerms) {
      const matchIndex = windows.findIndex((window) => window.text.includes(searchTerm));
      if (matchIndex < 0) {
        continue;
      }

      const startSegIdx = matchIndex;
      const endSegIdx = Math.min(startSegIdx + windowSize, input.transcript.length);
      const exactText = input.transcript
        .slice(startSegIdx, endSegIdx)
        .map((segment) => segment.text)
        .join(" ")
        .trim();

      const limitedWords = exactText.split(/\s+/).filter(Boolean).slice(0, 220);
      const trimmedQuote = limitedWords.join(" ").trim();
      const lastSegment = input.transcript[endSegIdx - 1];

      verified.push({
        label: point.label,
        quoteText: trimmedQuote,
        speaker: point.speaker,
        startMs: windows[matchIndex].startMs,
        endMs: lastSegment
          ? lastSegment.startMs + (lastSegment.durationMs || 5000)
          : windows[matchIndex].startMs + 15000,
        relevanceScore: point.relevanceScore,
        whyRelevant: point.whyRelevant,
        matchedSectionHeadings: point.matchedSectionHeadings,
        topics: point.topics,
      });
      matched = true;
      break;
    }

    if (!matched && point.quoteText.trim().length > 0) {
      verified.push(point);
    }
  }

  const deduped = Array.from(
    new Map(
      verified
        .filter((point) => point.relevanceScore >= 40)
        .sort((left, right) => right.relevanceScore - left.relevanceScore)
        .map((point) => [
          `${point.startMs}|${point.quoteText.toLowerCase().slice(0, 80)}`,
          point,
        ])
    ).values()
  );

  return {
    model: env.OPENAI_TRANSCRIPT_SCAN_MODEL,
    summary:
      deduped.length > 0
        ? `Found ${deduped.length} mission-relevant talking point${deduped.length === 1 ? "" : "s"} in ${input.videoTitle}.`
        : `No mission-relevant talking points found in ${input.videoTitle}.`,
    talkingPoints: deduped,
  };
}

// ─── Video Transcription (Whisper) ───

export interface WhisperSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

/**
 * Transcribes a video/audio file URL using OpenAI Whisper.
 * Downloads the media, sends to Whisper API, returns timestamped segments.
 */
export async function transcribeVideoUrl(
  videoUrl: string
): Promise<WhisperSegment[]> {
  // Download the video/audio
  const mediaResponse = await fetch(videoUrl);
  if (!mediaResponse.ok) {
    throw new Error(`Failed to download media: ${mediaResponse.status}`);
  }

  const buffer = Buffer.from(await mediaResponse.arrayBuffer());
  const blob = new Blob([buffer]);
  const file = new File([blob], "video.mp4", { type: "video/mp4" });

  const response = await getOpenAIClient().audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments = (response as unknown as {
    segments?: Array<{ text: string; start: number; end: number }>;
  }).segments ?? [];

  return segments.map((s) => ({
    text: s.text.trim(),
    startMs: Math.round(s.start * 1000),
    durationMs: Math.round((s.end - s.start) * 1000),
  }));
}

export async function summarizeShortVideoTranscript(input: {
  videoTitle: string;
  transcript: Array<{ text: string; startMs: number; durationMs: number }>;
  existingDescription?: string | null;
}): Promise<{ summary: string; model: string }> {
  const env = getEnv();

  if (input.transcript.length === 0) {
    return {
      summary:
        typeof input.existingDescription === "string" && input.existingDescription.trim().length > 0
          ? input.existingDescription.trim()
          : "No transcript available.",
      model: env.OPENAI_MEDIA_SOURCE_MODEL,
    };
  }

  const blocks: string[] = [];
  let current = "";
  let currentStartMs = 0;
  for (const segment of input.transcript) {
    if (!current) {
      current = segment.text;
      currentStartMs = segment.startMs;
      continue;
    }

    if (segment.startMs - currentStartMs < 15000 && current.length + segment.text.length < 400) {
      current += ` ${segment.text}`;
      continue;
    }

    const mins = Math.floor(currentStartMs / 60000);
    const secs = Math.floor((currentStartMs % 60000) / 1000);
    blocks.push(`[${mins}:${String(secs).padStart(2, "0")}] ${current.trim()}`);
    current = segment.text;
    currentStartMs = segment.startMs;
    if (blocks.join("\n").length >= 7000) {
      break;
    }
  }

  if (current && blocks.join("\n").length < 7000) {
    const mins = Math.floor(currentStartMs / 60000);
    const secs = Math.floor((currentStartMs % 60000) / 1000);
    blocks.push(`[${mins}:${String(secs).padStart(2, "0")}] ${current.trim()}`);
  }

  const response = await getOpenAIClient().responses.create({
    model: env.OPENAI_MEDIA_SOURCE_MODEL,
    max_output_tokens: 220,
    input: [
      {
        role: "system",
        content:
          "You summarize short social video transcripts for an editorial news board. Explain what concretely happens in the clip, who is involved, and why people are reacting. Be specific, compact, and grounded only in the transcript and caption. Do not hype. Use 1-2 sentences.",
      },
      {
        role: "user",
        content: [
          `Video title/caption: ${input.videoTitle}`,
          input.existingDescription?.trim()
            ? `Existing description: ${input.existingDescription.trim()}`
            : null,
          "",
          "Transcript:",
          blocks.join("\n"),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const summary = response.output_text.trim();

  return {
    summary: summary || (input.existingDescription?.trim() || input.videoTitle.trim()),
    model: env.OPENAI_MEDIA_SOURCE_MODEL,
  };
}

// ─── Ask AI about a video transcript ───

export async function askAboutTranscript(input: {
  question: string;
  transcript: Array<{ text: string; startMs: number; durationMs: number }>;
  videoTitle: string;
}): Promise<{
  answer: string;
  moments: Array<{ text: string; startMs: number; timestamp: string }>;
}> {
  // Combine into ~30sec blocks for manageable context
  const blocks: Array<{ text: string; startMs: number }> = [];
  let cur = { text: "", startMs: 0 };
  for (const seg of input.transcript) {
    if (!cur.text) { cur = { text: seg.text, startMs: seg.startMs }; }
    else if (seg.startMs - cur.startMs < 30000) { cur.text += " " + seg.text; }
    else { blocks.push(cur); cur = { text: seg.text, startMs: seg.startMs }; }
  }
  if (cur.text) blocks.push(cur);

  const transcriptText = blocks
    .map((b) => {
      const mins = Math.floor(b.startMs / 60000);
      const secs = Math.floor((b.startMs % 60000) / 1000);
      return `[${mins}:${String(secs).padStart(2, "0")}] ${b.text}`;
    })
    .join("\n")
    .slice(0, 50000);

  const response = await getOpenAIClient().responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `You answer questions about a video based on its transcript. Be specific and cite exact timestamps.

Return JSON with:
- answer: A clear, concise answer to the question
- moments: Array of relevant moments, each with:
  - text: The exact quote or what's said (cleaned up but faithful)
  - startMs: Timestamp in milliseconds
  - timestamp: Human readable like "3:42"

If the answer is "no" or the topic isn't discussed, say so clearly and return empty moments.
Always ground your answer in what's actually in the transcript.`,
      },
      {
        role: "user",
        content: `Video: "${input.videoTitle}"\n\nQuestion: ${input.question}\n\nTranscript:\n${transcriptText}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "transcript_answer",
        strict: true,
        schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            moments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  startMs: { type: "number" },
                  timestamp: { type: "string" },
                },
                required: ["text", "startMs", "timestamp"],
                additionalProperties: false,
              },
            },
          },
          required: ["answer", "moments"],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(response.output_text);
}

// ─── Script Assistant ───

export const scriptAssistantResponseSchema = z.object({
  result: z.string(),
  explanation: z.string(),
});

export type ScriptAssistantResponse = z.infer<typeof scriptAssistantResponseSchema>;

export async function scriptAssistant(input: {
  instruction: string;
  selectedText: string | null;
  fullScript: string;
  researchContext: string | null;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<ScriptAssistantResponse> {
  const historyMessages = (input.conversationHistory ?? []).map((msg) => ({
    role: msg.role as "user" | "assistant",
    content: msg.content,
  }));

  const userContent = [
    input.selectedText
      ? `Selected text:\n"${input.selectedText}"\n\n`
      : "",
    `Instruction: ${input.instruction}`,
    input.fullScript
      ? `\n\nFull script:\n${input.fullScript.slice(0, 30000)}`
      : "",
    input.researchContext
      ? `\n\nResearch context:\n${input.researchContext.slice(0, 10000)}`
      : "",
  ].join("");

  const response = await getOpenAIClient().responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `You are a script writing assistant for a YouTube news channel. You help writers improve their scripts by rewriting sections, suggesting improvements, adding transitions, making copy punchier, and more.

Rules:
- If the writer selected specific text, focus your changes on that text
- Keep the voice conversational and engaging — not corporate
- Preserve the writer's intent and factual claims
- Return the improved text in "result" and a brief explanation of what you changed in "explanation"
- If asked to shorten, actually cut words significantly
- If asked to add something, integrate it naturally into the existing flow`,
      },
      ...historyMessages,
      {
        role: "user",
        content: userContent,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "script_assistant_response",
        strict: true,
        schema: {
          type: "object",
          properties: {
            result: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["result", "explanation"],
          additionalProperties: false,
        },
      },
    },
  });

  return scriptAssistantResponseSchema.parse(JSON.parse(response.output_text));
}

// ─── Research Summarization ───

export async function summarizeResearch(input: {
  lineText: string;
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
    extractedMarkdown?: string;
  }>;
}): Promise<{ summary: string; model: string; confidenceScore: number }> {
  const env = getEnv();

  const response = await getOpenAIClient().responses.create({
    model: env.OPENAI_RESEARCH_MODEL,
    input: [
      {
        role: "system",
        content:
          "You are summarizing documentary research. Be concise, factual, and grounded in the supplied sources only. Mention ambiguity when evidence is weak.",
      },
      {
        role: "user",
        content: [
          `Script line: ${input.lineText}`,
          "",
          "Sources:",
          ...input.sources.map((source, index) =>
            [
              `${index + 1}. ${source.title}`,
              `URL: ${source.url}`,
              `Snippet: ${source.snippet || "No snippet available."}`,
              source.extractedMarkdown
                ? `Extracted content: ${source.extractedMarkdown.slice(0, 3000)}`
                : "Extracted content: unavailable",
            ].join("\n")
          ),
          "",
          "Return a short synthesis of the strongest facts and caveats for an editor.",
        ].join("\n"),
      },
    ],
  });

  return {
    summary: response.output_text.trim(),
    model: env.OPENAI_RESEARCH_MODEL,
    confidenceScore: Math.min(95, 65 + input.sources.length * 5),
  };
}
