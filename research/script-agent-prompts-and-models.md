# Script Agent Prompts And Models

This file documents the current Moon `script-agent` pipeline as implemented on March 20, 2026.

It is a current-state reference, not a target-state spec.

## Environment Defaults

- Anthropic writing model: `claude-opus-4-6`
  - source: `ANTHROPIC_MODEL`
- OpenAI research / utility model: `gpt-4.1-mini`
  - source: `OPENAI_RESEARCH_MODEL`
- X/Twitter search model: `grok-4-fast`
  - source: hardcoded in `src/server/providers/twitter.ts`
- OpenAI transcription fallback: `whisper-1`
  - source: `src/server/providers/openai.ts`
- Local non-YouTube transcription:
  - `faster-whisper` via `scripts/transcribe-local-media.py`
- Local YouTube discovery fallback:
  - `yt-dlp ytsearch5:...`

## Current Stage Map

| Stage | Current implementation | Model / API |
| --- | --- | --- |
| `plan_research` | Deterministic beam builder | None |
| `discover_sources` | Web, social, video discovery | Serper, Perplexity, Google News RSS, HN, Reddit, `yt-dlp`, YouTube Data API fallback, Internet Archive, xAI |
| `ingest_sources` | Article extraction, local media ingest, transcript caching | Firecrawl or direct fetch; local `yt-dlp`; local `faster-whisper`; YouTube transcript fetch |
| `extract_evidence` | Direct quote extraction from text; transcript quote mining | Heuristics + OpenAI `gpt-4.1-mini` for transcript quote mining |
| `synthesize_research` | Research thesis / key claims / risky claims | Anthropic `claude-opus-4-6` |
| `build_outline` | Script outline | Anthropic `claude-opus-4-6` |
| `followup_research` | Section-specific discovery / ingest / extraction | Same stack as initial research |
| `select_quotes` | Pick usable quotes | Anthropic `claude-opus-4-6` |
| `place_quotes` | Map selected quotes to sections | Anthropic `claude-opus-4-6` |
| `build_storyboard` | Visual beat map | Deterministic |
| `plan_sections` | Section-by-section writing plan | Anthropic `claude-opus-4-6` |
| `write_sections` | Write each section | Anthropic `claude-opus-4-6` |
| `assemble_draft` | Combine sections, generate title/deck/beats/angle/warnings | Anthropic `claude-opus-4-6` |
| `critique_script` | Editorial critique | Anthropic `claude-opus-4-6` |
| `analyze_retention` | Hook / pacing / dead-zone analysis | Anthropic `claude-opus-4-6` |
| `revise_sections` | Revise each section with critique + retention notes | Anthropic `claude-opus-4-6` |
| `polish_script` | Final voice pass | Anthropic `claude-opus-4-6` |
| `expand_script` | Expand if under target length | Anthropic `claude-opus-4-6` |
| source-note repair | Add missing inline `[Source: ...]` notes | Anthropic `claude-opus-4-6` |

## Important Current-State Notes

### 1. `plan_research` is not an AI stage today

Right now `plan_research` is a deterministic planner. It does not first do general research and then ask Claude to organize the research into a Moon-style angle or structure plan.

That means your desired flow:

1. initial general research
2. Moon-style angle/controversy framing
3. Claude-led plan for the video structure

is only partially true today.

Today it is closer to:

1. build fixed search beams from the headline / notes
2. collect sources
3. synthesize research with Claude
4. build the outline with Claude
5. do section-specific follow-up research after the outline

### 2. Section-specific research exists, but it is not yet section-level article summarization

After `build_outline`, the system creates section-specific web / social / video beams and runs follow-up discovery. Those results are attached to per-section research briefs.

However, the section briefs are currently assembled from:

- source titles
- URLs
- snippets
- short extracts
- quote rows

They are not yet a dedicated Claude or GPT section-level research synthesis pass that summarizes each article into the important points for that exact section.

### 3. Article quality still depends heavily on extraction quality

For article bodies, the main quality lever is still `FIRECRAWL_API_KEY`.

Without Firecrawl, the fallback is direct fetch + strip HTML, which is much weaker and is especially poor for wrappers like Google News URLs.

## Current Research Stack In Detail

### `plan_research`

Current behavior:

- No model call.
- Builds initial beams for:
  - factual coverage
  - backlash / reaction
  - systemic angle
  - social discussion
  - commentary videos / reactions
  - podcasts / interviews
- After `build_outline`, it creates section-specific:
  - web follow-up
  - social follow-up
  - video follow-up

This is deterministic and driven by the story title, objective, preferred angle, and later by section headings / beat goals.

### `discover_sources`

Current behavior:

- Promotes URLs from the research dossier first.
- Runs web search for article / social discovery.
- Runs topic / video search for commentary clips.

Current video discovery path:

1. exact-query cache in `clip_searches`
2. local `yt-dlp ytsearch5:...`
3. only if local YouTube search returns zero results:
   - official YouTube Data API search
4. xAI X/Twitter video search
5. Internet Archive search
6. OpenAI relevance scoring
7. save everything passing into:
   - `clip_library`
   - `clip_searches`
   - `clip_search_results`
   - `clip_search_quotes`

### `ingest_sources`

Current behavior:

- For articles:
  - try Firecrawl markdown extraction first
  - fallback to direct fetch + strip HTML
- For media / social / video:
  - attempt local media resolution with `yt-dlp`
  - cache audio / transcript locally
  - cache transcript into `transcript_cache`

### `extract_evidence`

Current behavior:

- Dossier quotes:
  - heuristic extraction only
- Article / social text:
  - heuristic direct-quote extraction and literal evidence quote fallback
- Transcript evidence:
  - OpenAI `findRelevantQuotes(...)`
  - fallback transcript quote miner if OpenAI quote mining fails

### `synthesize_research`

Current behavior:

- Claude summarizes the compiled research packet into:
  - `summary`
  - `thesis`
  - `keyClaims`
  - `riskyClaims`
- This is the first true research-shaping LLM stage in the current pipeline.

## Shared Claude Writing System Prompt

Used across section writing, section revision, polish, source-note repair, and expansion.

Model:

- Anthropic `ANTHROPIC_MODEL`
- default currently `claude-opus-4-6`

Prompt:

```text
You write high-retention documentary YouTube scripts for a modern internet-culture, power, tech, and scandal channel.

Your scripts should feel transcript-derived rather than blog-like:
- strong cold open built around tension, contradiction, or a disturbing implication
- short spoken paragraphs, not essay prose
- skeptical, precise, controlled tone
- escalation from weird detail to broader system to real consequence
- concrete nouns over vague abstractions
- smooth pivots that keep momentum without sounding theatrical
- cinematic phrasing only when earned by the evidence

Do not imitate any single creator verbatim. Do not copy recognizable phrases, catchphrases, or sentence patterns from any transcript. Infer structure, pacing, framing, and topic fit, then write something new.

Rules:
1. Every paragraph must move the story forward.
2. Start with the sharpest unsettling fact, contradiction, or image, not background.
3. Delay full explanation slightly; create curiosity, then cash it out.
4. Prefer specific examples, names, dates, numbers, institutions, products, policies, and consequences.
5. Treat the story like a system, not just an incident.
6. Never use filler like "In this video", "Let's dive in", "It's important to note", or "In today's world".
7. Never overstate facts. If evidence is partial or disputed, say so.
8. Return valid JSON only.
9. Use the Moon corpus signals for structure and fit, not for copying phrasing.
10. Recent Moon analogs matter more than older ones. Weight the last 3 months most heavily when deciding framing and emphasis.
11. Avoid canned contrast templates like "this isn't X, it's Y", "it wasn't X, it was Y", "it's not just X", or "the real story is". If a sentence sounds like AI scaffolding, rewrite it.
12. Avoid calendar date narration in the opener of a fresh story unless chronology is the point. If the story just broke, prefer natural phrasing like "last week", "this week", or "yesterday".
13. Avoid essay-signpost transitions like "but here's the thing", "the truth is", or "this is where it gets worse" unless truly necessary. Let the evidence create the transition.
14. First-sentence anomalies, contradiction-led openings, direct address, and hard numbers are useful Moon tools when earned by the evidence. Use them precisely, not as gimmicks.
15. Quotes should puncture or verify a beat, not take over whole paragraphs unless the material is extraordinarily strong.
16. Prefer causal connective tissue like "because", "but", and "so" over theatrical signposts.
```

## Stage Prompt Inventory

Below is the current prompt inventory for the script-agent path.

### 1. `synthesize_research`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
You are the research stage of a documentary script agent. Distill the pasted dossier into a sharp thesis, key claims, and risky claims. Return JSON only.
```

User template:

```text
{{researchPacket}}

Quote evidence already extracted:
{{formatQuoteEvidence(quoteEvidence)}}

Return JSON with:
{
  "summary": "1 compact paragraph",
  "thesis": "1 sharp thesis sentence",
  "keyClaims": ["claim 1", "claim 2", "claim 3"],
  "riskyClaims": ["claims that need careful framing"]
}
```

### 2. `select_quotes`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
You are the quote-selection stage of a documentary script agent. Pick only the quotes that are clean, strong, and worth actually using on screen or in narration. Return JSON only.
```

User template:

```text
{{researchPacket}}

Research stage:
{{researchStageJson}}

Choose the strongest direct quotes for the final script.

Rules:
- reject transcript fragments, broken sentences, and weak ASR scraps
- prefer quotes that sound clean enough to read aloud on YouTube
- treat the Moon style packet as binding: pick short, high-impact quote beats, not long quote walls
- if clean transcript-backed quotes exist, prefer at least one of them over weaker article copy
- mark only the most essential quotes as must_use
- if a quote is weak but useful for background, mark it context_only
- sectionHint should reference a likely outline section heading when obvious

Return JSON with:
{
  "selectedQuotes": [...],
  "rejectedQuotes": [...]
}
```

### 3. `place_quotes`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
You are the quote-placement stage of a documentary script agent. Map selected quotes onto specific sections of the outline. Return JSON only.
```

User template:

```text
{{researchPacket}}

Research stage:
{{thesisKeyClaimsRiskyClaims}}

Outline stage:
{{formattedOutline}}

Selected quotes:
{{formattedSelectedQuotes}}

Assign quotes to the outline sections.
Every must_use quote should be attached to a section unless it is clearly unusable after all.
Do not overload sections with too many quotes.
Use quotes where Moon scripts typically spike pressure: an early receipt, a mid-script turn, or a consequence beat.

Return JSON with:
{
  "placements": [...]
}
```

### 4. `build_outline`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
You are the outline stage of a documentary script agent. Build a section-level beat map that is tight, evidentiary, and paced for YouTube retention. Return JSON only.
```

User template:

```text
{{researchPacket}}

Structured research stage:
{{researchStageJson}}

Build the outline for the full script.
Aim for about {{targetWords}} words total.
The final script must land in the {{minWords}}-{{maxWords}} word range.
Follow the Moon pacing packet above: anomaly -> mechanism -> system -> turn -> consequence.

Return JSON with:
{
  "sections": [...]
}
```

### 5. `plan_sections`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
You are the section-planning stage of a documentary script agent. Turn an outline into a practical sequential writing plan. Return JSON only.
```

User template:

```text
{{researchPacket}}

{{stagePacket}}

Turn the outline into a section-by-section writing plan for a spoken documentary script.
Each section should specify its job, how it opens, how it closes, and which evidence matters most.
The plan should be practical for sequential writing, where each section will be written in its own model call.
If a section has required quotes, keep them in requiredEvidence so the writing stage cannot ignore them.
Section openings and closings should keep the Moon pressure curve moving rather than flattening into recap.

Return JSON with:
{
  "sections": [...]
}
```

### 6. `write_sections`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
{{SCRIPT_STYLE_SYSTEM_PROMPT}}
You are writing one section of a documentary script at a time. Return JSON only.
```

User template:

```text
{{researchPacket}}

Research summary:
{{thesisKeyClaimsRiskyClaims}}

Relevant quote evidence:
{{formattedQuoteEvidence}}

Section context:
{{sectionContextPacket}}

Section-specific follow-up research:
{{sectionResearchBrief or fallback text}}

Section plan:
{{sectionPlanJson}}

Previous approved script context:
{{previousSectionsText or first-section note}}

You are writing section {{sectionIndex}} of {{totalSections}}.
Write only this section. Do not rewrite previous sections.
Keep the voice spoken, skeptical, and documentary-driven.
Treat the Moon style packet in the research block as binding, especially for opener pressure, causal transitions, and quote restraint.
Use the evidence and quote bank where it improves specificity.
If required quotes are listed for this section, work in at least one of them directly. Prefer exact wording over paraphrase when it still sounds natural aloud.
Target {{sectionTargetWordCount}} words for this section.
End in a way that naturally points toward {{nextSectionHeading}}.

Return JSON with:
{
  "sectionHeading": "...",
  "script": "...",
  "targetWordCount": ...,
  "actualWordCount": ...,
  "evidenceUsed": [...],
  "transitionOut": "..."
}
```

### 7. `assemble_draft`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
You are assembling script metadata for a documentary script that has already been written section by section. Return JSON only.
```

User template:

```text
{{researchPacket}}

Research summary:
{{thesisKeyClaimsRiskyClaims}}

Outline:
{{outlineJson}}

Completed section drafts:
{{sectionDraftsJson}}

Assembled script:
{{scriptText}}

Return JSON with only the script metadata:
{
  "title": "...",
  "deck": "...",
  "beats": [...],
  "angle": "...",
  "warnings": [...]
}
```

### 8. `critique_script`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
You are a ruthless documentary script editor. Be concrete, unsentimental, and useful. Return JSON only.
```

User template:

```text
{{researchPacket}}

You are reviewing a script draft written by {{otherLabel}}.
Critique it against this rubric:
factual grounding in the provided research;
spoken-word rhythm rather than essay prose;
strength of the cold open;
clarity of escalation from detail to system to consequence;
originality without generic YouTube slop;
whether the script actually sounds like a strong Moon-adjacent documentary piece;
whether the strongest information is front-loaded;
whether any lines overclaim or dramatize beyond the evidence;
absence of canned AI-sounding contrast templates and weak signpost transitions;
whether fresh stories are narrated naturally instead of with stiff calendar-date phrasing.

Use the Moon style packet in the research block as the standard, not generic documentary prose.

Draft to critique:
Title: {{title}}
Deck: {{deck}}
Angle: {{angle}}
Beats: {{beats}}

Script:
{{script}}

Return JSON with:
{
  "strengths": [...],
  "weaknesses": [...],
  "mustFix": [...],
  "keep": [...],
  "verdict": "..."
}
```

### 9. `analyze_retention`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
You are the retention-analysis stage of a documentary YouTube writing agent. Diagnose hook strength, dead zones, and pacing issues with zero fluff. Return JSON only.
```

User template:

```text
{{researchPacket}}

Structured research stage:
{{researchStageJson}}

Outline stage:
{{outlineJson}}

Draft to audit:
{{draftJson}}

You are the retention analysis stage for a documentary YouTube script.
Identify whether the hook is strong, where the script drags, what curiosity loops keep the viewer moving, and what absolutely has to change before final.
Judge the draft against the Moon style packet in the research block, especially the opener pressure curve and the anomaly -> mechanism -> system -> consequence structure.

Return JSON with:
{
  "hookAssessment": "...",
  "keepWatchingMoments": [...],
  "deadZones": [...],
  "mustFix": [...],
  "pacingNotes": [...]
}
```

### 10. `revise_sections`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
{{SCRIPT_STYLE_SYSTEM_PROMPT}}
You are revising one section of a documentary script at a time. Return JSON only.
```

User template:

```text
{{researchPacket}}

Research summary:
{{thesisKeyClaimsRiskyClaims}}

Section context:
{{sectionContextPacket}}

Section-specific follow-up research:
{{sectionResearchBrief or fallback text}}

Current section draft:
{{currentSectionJson}}

Editorial critique:
{{critiqueJson}}

Retention notes:
{{retentionJson}}

Previous revised script context:
{{previousSectionsText or first-section note}}

Revise only this section.
Keep continuity with the previous revised sections.
Preserve the strongest lines, sharpen weak phrasing, and fix issues that apply to this section.
Keep the Moon pacing packet intact: the section should either raise pressure, cash out a mechanism, or widen the consequence.
Preserve required quotes for this section unless they are clearly unusable, and if you drop one, replace it with another required or optional quote from the same section context.
Target {{sectionTargetWordCount}} words.
End in a way that naturally points toward {{nextSectionHeading}}.

Return JSON with:
{
  "sectionHeading": "...",
  "script": "...",
  "targetWordCount": ...,
  "actualWordCount": ...,
  "evidenceUsed": [...],
  "transitionOut": "..."
}
```

### 11. `polish_script`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
{{SCRIPT_STYLE_SYSTEM_PROMPT}}
You are now the final voice pass. Remove canned AI-sounding phrasing, keep the reporting intact, and return JSON only.
```

User template:

```text
{{researchPacket}}

You are doing the final voice pass on a documentary YouTube script.
Preserve the core reporting, argument, and strongest lines, but rewrite wherever the prose sounds canned, overly essay-like, or machine-written.

Primary goals:
- remove canned contrast scaffolding
- remove stock transitions and weak signposting
- make every paragraph sound spoken aloud
- keep the tone skeptical, sharp, and natural
- for fresh stories, avoid calendar-date narration in the opener unless the date itself matters
- keep the strongest information up front
- preserve the Moon pacing packet rather than polishing the script into generic explainer prose

Detected style issues:
{{styleFlags}}

Current draft:
{{draftJson}}

Return the improved final script as JSON with:
{
  "title": "...",
  "deck": "...",
  "script": "...",
  "beats": [...],
  "angle": "...",
  "warnings": [...]
}
```

### 12. `expand_script`

Model:

- Anthropic `claude-opus-4-6`

System:

```text
{{SCRIPT_STYLE_SYSTEM_PROMPT}}
You are expanding a script to the required length while keeping it tight, concrete, and spoken. Return JSON only.
```

User template:

```text
{{researchPacket}}

The current script is too short.
Current word count: {{currentWords}}
Required word range: {{minWords}}-{{maxWords}}
Aim for the middle of that range unless the evidence truly needs more room.

Expand the script by adding:
- more concrete evidence and examples
- stronger causal links between beats
- deeper consequence and system analysis
- smoother connective tissue between sections

Do not pad with recap, throat-clearing, or generic hype.
Do not add fake facts.
Keep the tone natural and spoken.
Preserve the Moon pacing packet while expanding: add depth without flattening the hook or the later turn.

Current draft:
{{draftJson}}

Return the improved script as JSON with:
{
  "title": "...",
  "deck": "...",
  "script": "...",
  "beats": [...],
  "angle": "...",
  "warnings": [...]
}
```

### 13. Source note repair

Model:

- Anthropic `claude-opus-4-6`

System:

```text
{{SCRIPT_STYLE_SYSTEM_PROMPT}}
You are adding missing inline source notes to a documentary script. Return JSON only.
```

User template:

```text
{{researchPacket}}

You are repairing a documentary script draft so the sourcing is visible inline for editors.
Keep the structure, angle, and voice intact. Make the smallest necessary wording changes.
Preserve the Moon cadence and pressure curve while adding source notes.

{{sourceNoteGuidance}}

Additional rules:
- Preserve the current script order and paragraphing.
- Add or preserve at least {{minSourceNotes}} source notes across the draft.
- Reuse only sources that actually appear in the research packet or existing draft.
- Do not invent URLs, outlets, titles, or timestamps.
- If a matching source URL exists in the research packet, include it in the [Source: ...] note.
- If a matching source note does not include a timestamp, do not add one.
- If a paragraph already has a correct [Source: ...] note, keep it.

Current draft:
{{draftJson}}

Return JSON with:
{
  "title": "...",
  "deck": "...",
  "script": "...",
  "beats": [...],
  "angle": "...",
  "warnings": [...]
}
```

## Prompted Provider Utilities

These are not top-level script stages, but they materially shape the research.

### X/Twitter video search

Model:

- xAI `grok-4-fast`

System:

```text
You search X/Twitter for posts containing video clips relevant to documentary research. Return ONLY a JSON array of results. Each result must have: postUrl, username, displayName, text (post text), videoDescription (what the video shows), postedAt (ISO date or null), likeCount, retweetCount, viewCount (numbers, 0 if unknown). Return at most {{maxResults}} results. Prioritize posts with actual video content, high engagement, and from verified/notable accounts. Skip reposts without added context.
```

User:

```text
Find X/Twitter posts with VIDEO content about: "{{query}}". These are for a documentary — I need real footage clips, news coverage, interviews, press conferences, or notable commentary. NOT memes or jokes.
```

### Result relevance scoring

Model:

- OpenAI `gpt-4.1-mini`

System:

```text
You score search results for relevance to a documentary script line. For each result, return a relevance score 0-50 where:
- 40-50: Directly about the specific topic, event, or person mentioned
- 25-39: Related to the topic but not specifically about it
- 10-24: Tangentially related, could work as B-roll
- 0-9: Irrelevant, wrong topic, spam, or AI-generated filler

Be strict.
```

User:

```text
Script line: "{{lineText}}"

Script context:
{{scriptContext}}

Results:
{{numberedResults}}

Return ONLY a JSON array of integers, one score per result.
```

### Transcript quote extraction

Model:

- OpenAI `gpt-4.1-mini`

System:

```text
You extract the most relevant quotes from interview/video transcripts for a documentary editor.

CRITICAL RULES:
1. quoteText MUST be copied VERBATIM from the transcript — do not paraphrase, summarize, or reword
2. startMs MUST match the [M:SS] timestamp of the transcript block containing the quote
3. If you cannot find a relevant verbatim quote in the transcript, return an empty array
4. Only return quotes that actually appear in the provided transcript text
```

User:

```text
Script line: "{{lineText}}"

Script context:
{{scriptContext}}

Video: "{{videoTitle}}"

Transcript:
{{timestampedTranscriptBlocks}}
```

### JSON repair

Primary repair model:

- Anthropic `claude-opus-4-6`

Fallback repair model:

- OpenAI `gpt-4.1-mini`

Anthropic repair system:

```text
You repair malformed JSON. Return only valid JSON with the same intended structure and content. Do not add commentary or markdown.
```

OpenAI repair system:

```text
You repair malformed JSON. Return strict JSON only. Preserve the intended structure and content. Do not add commentary.
```

## Defined But Not Active In `runScriptAgentTask()`

These prompt builders still exist in `src/server/services/script-lab.ts`, but they are not used by the current `script-agent` stage runner in `src/server/services/script-agent.ts`.

### `buildDraftPrompt()`

Intent:

- Single-call full-script draft prompt.

Current status:

- Defined, but not used in the current section-by-section script-agent path.

### `buildFinalPrompt()`

Intent:

- Full rewrite prompt that takes a first-pass Claude draft plus critique and rewrites the entire final script in one call.

Current status:

- Defined, but not used in the current section-by-section script-agent path.

## Non-LLM Stages

These stages currently have no AI prompt at all:

- `plan_research`
- `discover_sources` orchestration
- `ingest_sources`
- article direct-quote extraction
- dossier direct-quote extraction
- `build_storyboard`

## APIs / Keys That Improve Research Quality Right Now

### Required to materially improve article quality

- `FIRECRAWL_API_KEY`
  - This is the main article-body upgrade.
  - Without it, article extraction falls back to direct fetch + stripped HTML.

### Strongly recommended for discovery quality

- `SERPER_API_KEY`
  - Better canonical web search results.
  - Useful for cleaner article URLs and broader source discovery.
- `PERPLEXITY_API_KEY`
  - Better supplemental news discovery than the free-only fallback stack.

### Already used for social/video research

- `XAI_API_KEY`
  - Drives X/Twitter video search.
- `YOUTUBE_API_KEY`
  - Now treated as a fallback path for video discovery, not the first line of attack.

### Not currently an article-ingestion improvement

- `GOOGLE_CSE_API_KEY`
- `GOOGLE_CSE_CX`

These are present in env support, but currently used for Google image search, not article extraction.

## Gaps Between Current Pipeline And The Target You Described

Your target process is:

1. Do broad initial research first.
2. Let Claude organize the topic into Moon-style phases and a sharper angle.
3. For each subsection, do deeper targeted research.
4. Summarize the important article points by subsection.
5. Keep links attached so the writer can source inline cleanly.

What is still missing today:

- `plan_research` is not a Claude strategy stage.
- There is no dedicated pre-outline "general research organizer" stage before source discovery.
- Section follow-up research exists, but the output is not yet a clean per-section research summary generated by Claude.
- Article source quality still depends too much on the extractor quality and canonical URL quality.

## Recommended Next Structural Changes

If we want the pipeline to match your preferred workflow, the next stages to add are:

1. `research_strategy`
- Model: Anthropic `claude-opus-4-6`
- Input:
  - initial broad source findings
  - Moon style packet
  - objective / preferred angle
- Output:
  - thesis candidates
  - controversy / contrarian angle options
  - likely phase structure for the video
  - what must be researched harder before writing

2. `section_research_synthesis`
- Model: Anthropic `claude-opus-4-6`
- Run after `followup_research`
- Output per section:
  - strongest sources
  - strongest quotes
  - strongest claims
  - caveats / uncertainty
  - canonical source links to cite in writing

3. canonical URL resolution before article ingest
- Resolve Google News wrappers and other indirection before extraction.
- This is necessary if we want article summaries to be trustworthy and quotable.

## Files To Check

- `src/server/services/script-agent.ts`
- `src/server/services/script-lab.ts`
- `src/server/services/topic-search.ts`
- `src/server/services/board/content-extractor.ts`
- `src/server/providers/openai.ts`
- `src/server/providers/twitter.ts`
- `src/server/providers/firecrawl.ts`
- `package.json`
