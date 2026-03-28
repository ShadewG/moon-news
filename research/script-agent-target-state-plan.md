# Moon Script-Agent Target-State Plan

This file captures the target workflow for Moon script generation based on the editorial direction discussed on March 20, 2026.

It is a proposed architecture and prompt plan. It is not the current live behavior.

## Why `plan_research` Must Become An AI Stage

Right now `plan_research` is a deterministic beam builder. That is cheap, but it is not good enough for Moon.

For Moon, the planning step is where the angle is found:

- what the real story is
- what the hidden system is
- what contradiction makes the hook work
- what sections are actually worth covering
- what evidence needs to be gathered to support that angle

That means the first planning stage should not be a fixed template. It should be a Claude stage informed by an initial broad research sweep.

## Target Principles

1. The first pass is broad, expensive, and smart. It should answer: what is this story really about?
2. The second pass is structured. Claude should turn the first pass into a Moon-style research plan and section map.
3. The third pass is sectional. Each section gets its own targeted research, videos, posts, threads, podcasts, and articles.
4. Evidence must be normalized before writing. Article facts, social posts, and transcript quotes should all be converted into usable section briefs with links.
5. Writing should happen only after the evidence is structured well enough that Claude can cite naturally.
6. Every search result worth keeping should be saved so repeated stories and follow-ups get cheaper over time.

## Target Stage Map

| Stage | Goal | Model / stack | Output |
| --- | --- | --- | --- |
| `normalize_story` | Turn a headline, tweet, tip, or short brief into a clean story seed | deterministic | title, entities, aliases, likely domain, urgency |
| `initial_broad_research` | Get a high-context view of the story and surrounding discourse | strongest Perplexity research model available at runtime | broad research memo with citations |
| `research_strategy` | Turn the broad memo into a Moon angle and research map | Anthropic `claude-opus-4-6` | thesis candidates, section plan, evidence gaps, search priorities |
| `section_query_planning` | Generate targeted searches for each proposed section | Anthropic `claude-opus-4-6` | section-specific search beams |
| `discover_sources_global` | Run conservative global discovery across web, video, social, podcasts | Serper, Perplexity, Grok, `yt-dlp`, YouTube API fallback, RSS/search APIs | saved source candidates |
| `discover_sources_sectional` | Run section-specific discovery based on the section beams | same stack as above | saved section-linked source candidates |
| `ingest_sources` | Resolve URLs, extract article text, download media, transcribe where needed | Firecrawl, local `yt-dlp`, local transcription, direct fetch fallback | normalized source content |
| `extract_article_points` | Pull the most important facts and claims from each article for this story | Anthropic `claude-opus-4-6` or strong research utility model | article fact summaries with URLs |
| `extract_transcript_quotes` | Pull exact quotes from transcripts relevant to each section | OpenAI research model or Claude utility pass | timestamped quotes with links |
| `section_research_synthesis` | Build section briefs from all evidence collected for that section | Anthropic `claude-opus-4-6` | section briefs with claims, evidence, and usable quotes |
| `build_outline` | Turn section briefs into a Moon outline | Anthropic `claude-opus-4-6` | outline with hook, turns, ending |
| `place_quotes` | Decide where sourced quotes should appear | Anthropic `claude-opus-4-6` | quote-to-section map |
| `build_storyboard` | Turn the outline into scene and pacing beats | Anthropic `claude-opus-4-6` | storyboard beats |
| `write_sections` | Write the sections using the structured briefs and quote map | Anthropic `claude-opus-4-6` | section drafts |
| `assemble_draft` | Build the full draft | Anthropic `claude-opus-4-6` | first full script |
| `critique_script` | Review the draft against Moon criteria | Anthropic `claude-opus-4-6` | critique notes |
| `revise_script` | Apply critique and sharpen weak beats | Anthropic `claude-opus-4-6` | revised draft |
| `final_editorial_review` | Final pass for sourcing, pacing, and Moon fit | Anthropic `claude-opus-4-6` | final draft |

## Preferred Research Flow

### 1. Story Intake

Input can be:

- a headline
- a tweet
- a video link
- a short brief
- a dossier

The system should immediately normalize:

- canonical story title
- major entities
- aliases and search terms
- likely topic family
- likely Moon angle candidates

This part can remain deterministic.

### 2. Initial Broad Research

This should be a large Perplexity pass. Its job is not to write the script. Its job is to answer:

- what happened
- why people care
- what the strongest interpretations are
- what the likely false leads are
- what broader system or pattern this belongs to
- where the controversy, contradiction, or hidden mechanism is

This should search broadly enough to establish context before section planning.

### 3. Claude Research Strategy

Claude should read the initial research memo and decide:

- what the real angle is
- whether this is mostly a scandal story, product-failure story, institutional-collapse story, power story, or media-narrative story
- what sequence of sections makes the best Moon video
- what evidence is still missing
- which sections need the most aggressive follow-up research

This is the stage that should replace the current deterministic `plan_research`.

### 4. Section-Level Research

Each section should get targeted follow-up research across:

- articles
- YouTube videos
- podcasts
- Reddit threads
- X / Twitter posts and videos
- TikTok videos
- Instagram posts or reels
- LinkedIn posts when relevant

The section searches should be different from each other. The point is not one giant source pile. The point is section-specific reporting.

### 5. Structured Evidence Extraction

Before outline and writing, the raw sources should be converted into structured material:

- article summaries focused on the section goal
- source-linked factual claims
- transcript-backed exact quotes
- notes on whether the source is high-confidence, commentary, or noisy

Claude should not have to infer everything from raw article text during section writing. The synthesis work should be done earlier.

### 6. Outline, Storyboard, Writing, Review

Only after the evidence is structured should Claude:

- build the outline
- place quotes
- build the storyboard
- write the sections
- critique the draft
- revise it
- finalize it

## Proposed Prompts

These are the target prompts to review before implementation.

### `initial_broad_research`

Model:

- strongest Perplexity research model available at runtime

Prompt:

```text
You are doing the first research pass for a Moon documentary YouTube script.

Story seed:
{{storySeed}}

Moon editorial philosophy:
- Look for the real system behind the incident.
- Prefer contradiction, power, incentives, incompetence, image-management, institutional drift, and hidden consequences.
- Do not just summarize what happened. Figure out what makes this story matter.
- Surface the strongest competing interpretations.
- Separate confirmed facts from rumor, speculation, and commentary.
- Pull in reporting, reaction, social discussion, commentary videos, and broader context if it helps explain the story.

Return:
1. A compact factual overview
2. The most important known facts with sources
3. The strongest tensions or contradictions in the story
4. The broader system this story may belong to
5. The strongest open questions
6. A list of likely section-worthy subtopics for a 10 to 12 minute Moon video
7. Key URLs and sources grouped by usefulness
```

### `research_strategy`

Model:

- Anthropic `claude-opus-4-6`

Prompt:

```text
You are planning research for a Moon documentary script.

Story seed:
{{storySeed}}

Initial research memo:
{{initialResearchMemo}}

Moon style guidance:
{{moonStyleGuide}}

Your job is not to write the script yet.

Your job:
1. Identify the strongest Moon angle for this story.
2. Explain what the hook should be.
3. Decide what kind of story this is.
4. Propose the best section order for a 10 to 12 minute video targeting roughly 2,500 words.
5. Identify what evidence each section still needs.
6. Identify what sources would be most valuable for each section.
7. Flag likely false leads, low-value sections, and overkill sections.

Return JSON:
{
  "primaryAngle": "",
  "backupAngles": [],
  "hookIdea": "",
  "storyType": "",
  "videoStructure": [
    {
      "sectionId": "s1",
      "title": "",
      "purpose": "",
      "whyItMatters": "",
      "evidenceNeeded": [],
      "searchPriorities": [],
      "targetWordCount": 0
    }
  ],
  "globalSearchThemes": [],
  "risks": [],
  "skip": []
}
```

### `section_query_planning`

Model:

- Anthropic `claude-opus-4-6`

Prompt:

```text
You are planning follow-up research queries for a Moon documentary script.

Story seed:
{{storySeed}}

Research strategy:
{{researchStrategy}}

For each section, generate the minimum high-value searches needed to get strong evidence without wasting quota.

You may recommend searches across:
- articles / web reporting
- YouTube videos
- podcasts
- X / Twitter posts and videos
- Reddit threads
- TikTok
- Instagram
- LinkedIn

Rules:
- Be specific.
- Use aliases, names, dates, products, events, and institutions when useful.
- Prefer 2 to 4 strong queries per source type, not dozens of weak ones.
- If a source type is unlikely to help for a section, omit it.
- Focus on finding evidence that sharpens the section's argument.

Return JSON:
{
  "globalQueries": [],
  "sectionQueries": [
    {
      "sectionId": "s1",
      "articleQueries": [],
      "videoQueries": [],
      "socialQueries": [],
      "podcastQueries": []
    }
  ]
}
```

### `extract_article_points`

Model:

- Anthropic `claude-opus-4-6` for quality mode
- optional lower-cost research utility model for fallback mode

Prompt:

```text
You are extracting only the facts from an article that matter for a specific Moon video section.

Section goal:
{{sectionGoal}}

Story angle:
{{primaryAngle}}

Article:
Title: {{title}}
URL: {{url}}
Publisher: {{publisher}}
Text:
{{articleText}}

Return JSON:
{
  "summary": "",
  "importantPoints": [
    {
      "point": "",
      "whyItMatters": "",
      "confidence": "high|medium|low"
    }
  ],
  "usableQuotes": [],
  "riskyClaims": []
}
```

### `extract_transcript_quotes`

Model:

- OpenAI research utility model or Anthropic utility pass

Prompt:

```text
You are selecting exact transcript quotes for a Moon documentary script.

Section goal:
{{sectionGoal}}

Story angle:
{{primaryAngle}}

Source:
{{transcriptSourceMeta}}

Transcript:
{{transcriptText}}

Pick only quotes that directly sharpen the section's argument.
Ignore filler, introductions, ad reads, and generic opinion unless it reveals something important.

Return JSON:
{
  "quotes": [
    {
      "quote": "",
      "reason": "",
      "startMs": 0,
      "endMs": 0
    }
  ]
}
```

### `section_research_synthesis`

Model:

- Anthropic `claude-opus-4-6`

Prompt:

```text
You are building a research brief for one section of a Moon documentary script.

Story seed:
{{storySeed}}

Primary angle:
{{primaryAngle}}

Section:
{{sectionSpec}}

Evidence collected:
{{sectionEvidence}}

Return JSON:
{
  "sectionSummary": "",
  "coreClaims": [],
  "strongestEvidence": [],
  "counterpoints": [],
  "usableQuotes": [],
  "mustCiteFacts": [],
  "weakAreas": []
}
```

### `build_outline`

Model:

- Anthropic `claude-opus-4-6`

Prompt:

```text
You are outlining a Moon documentary script.

Story seed:
{{storySeed}}

Primary angle:
{{primaryAngle}}

Moon style guide:
{{moonStyleGuide}}

Section briefs:
{{sectionBriefs}}

Write an outline for a 10 to 12 minute video targeting roughly 2,500 words.

Requirements:
- the opener must create tension quickly
- the order should escalate
- each section must materially change the viewer's understanding
- do not waste time on low-value background
- note where sourced quotes should land

Return JSON:
{
  "hook": "",
  "sections": [],
  "ending": "",
  "quotePlacementNotes": []
}
```

### `critique_script`

Model:

- Anthropic `claude-opus-4-6`

Prompt:

```text
You are reviewing a Moon documentary script draft.

Story seed:
{{storySeed}}

Moon style guide:
{{moonStyleGuide}}

Section briefs:
{{sectionBriefs}}

Draft:
{{draft}}

Judge the draft on:
- hook strength
- clarity of angle
- pacing
- section logic
- use of evidence
- use of quotes
- whether it sounds like Moon instead of generic AI narration
- whether any section drifts into summary instead of argument

Return JSON:
{
  "overallVerdict": "",
  "majorProblems": [],
  "lineLevelWeaknesses": [],
  "missingEvidence": [],
  "revisionPriorities": []
}
```

## Search And Cost Strategy

The system should be strong enough for 10 to 20 scripts per day without carelessly burning quota.

### Global rules

1. Save every normalized source URL in the database.
2. Save every normalized search query and its results in the database.
3. Save all transcripts and article extraction results in cache tables.
4. Reuse cached search results before calling providers again.
5. Reuse article extraction if the canonical URL has already been processed recently.
6. Reuse transcript caches by canonical media URL.

### Per-story budget shape

- One expensive Perplexity broad-research pass
- One Claude research-strategy pass
- One Claude section-query-planning pass
- Conservative API searches for each section
- Claude article and section synthesis passes only after enough evidence is collected
- One main writing pipeline

### Search provider priorities

1. Reuse local cache first.
2. Use local `yt-dlp` search for YouTube before the YouTube Data API.
3. Use the YouTube Data API only when local search does not find enough relevant results.
4. Use Grok for X discovery where it is strong.
5. Use Perplexity for the broad initial memo and for selective gap-filling, not for every tiny section query.
6. Use Firecrawl for canonical article extraction whenever possible.

## APIs That Matter Most

### Needed for the target pipeline

- `PERPLEXITY_API_KEY`
- `FIRECRAWL_API_KEY`
- `SERPER_API_KEY`
- `XAI_API_KEY`
- `YOUTUBE_API_KEY`
- Anthropic key for Claude writing and synthesis

### Nice to have

- a higher-quality article extraction fallback
- a better podcast search source
- platform-specific post resolvers for X, TikTok, Instagram, and LinkedIn

## What Should Change In The Live Pipeline

1. Replace deterministic `plan_research` with:
   - `initial_broad_research`
   - `research_strategy`
   - `section_query_planning`
2. Move section-level research synthesis before outline writing.
3. Add article-focused extraction and summarization per section.
4. Keep transcript quote extraction as an explicit stage with section context.
5. Make outline, storyboard, and writing consume section briefs instead of raw source piles.
6. Keep the final critique and revision loop.

## Recommended Immediate Implementation Order

1. Add `initial_broad_research` using Perplexity.
2. Add Claude `research_strategy`.
3. Add Claude `section_query_planning`.
4. Add `section_research_synthesis`.
5. Refactor outline and writing stages to consume section briefs.
6. Then tune search budgets and caching.
