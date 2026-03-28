# AI Model Breakdown

Updated: 2026-03-25

This reflects the current `moon-news` process after the cost-control changes:
- no Opus in the normal path
- Anthropic forced to Sonnet for planning and writing
- transcript quote extraction moved to OpenAI
- `searchTopic()` quote mining is opt-in instead of automatic

## Default Model Policy

- Parallel deep research: `pro-fast`
- Parallel search / extract: no LLM model exposed in app code
- OpenAI research utility: `gpt-4.1-mini`
- OpenAI transcript quote extraction: `gpt-4.1-mini`
- Anthropic planning: `claude-sonnet-4-6`
- Anthropic writing: `claude-sonnet-4-6`
- Opus: disabled by policy in runtime model selection

## Direct Research Report

File: `scripts/build-direct-research-outline-report.ts`

1. Deep memo
- Provider: Parallel
- Call: `runDeepResearchMemo(...)`
- Model / processor: `pro-fast`
- Count: `1x` per report

2. Article search
- Provider: Parallel
- Call: `searchResearchSources(...)`
- Count: multiple query batches
- Model: provider-managed search, no app-level LLM model setting

3. Article extraction
- Provider: Parallel
- Call: `extractContent(...)`
- Count: up to selected article count
- Model: provider-managed extract, no app-level LLM model setting

4. Article fact extraction
- Provider: OpenAI
- Call: `extractArticleFactsFromMarkdown(...)`
- Model: `OPENAI_RESEARCH_MODEL`
- Default: `gpt-4.1-mini`
- Count: `1x` per extracted article

5. Media discovery
- Provider: local `yt-dlp`, Parallel search, YouTube API, Internet Archive, X
- Call: `searchTopic(...)`
- Count: multiple media queries
- AI model use inside this step:
  - relevance scoring only
  - no automatic quote extraction by default anymore

6. Transcript recovery
- Provider: local cache / YouTube subtitles / local ingest
- Model: none unless local whisper fallback is needed
- Count: up to selected YouTube transcript targets

7. Transcript quote extraction
- Provider: OpenAI
- Call: `findRelevantQuotes(...)`
- Model: `OPENAI_QUOTE_EXTRACTION_MODEL`
- Default: `gpt-4.1-mini`
- Count: `1x` per shortlisted transcript clip in the direct report path
- Note: this used to run multiple prompts per clip; it is now collapsed to one richer pass per clip

8. Research synthesis
- Provider: Anthropic
- Call: `generateResearchStage(...)`
- Model: `ANTHROPIC_WRITING_MODEL`
- Default: `claude-sonnet-4-6`
- Count: `1x`

9. Outline
- Provider: Anthropic
- Call: `generateOutlineStage(...)`
- Model: `ANTHROPIC_WRITING_MODEL`
- Default: `claude-sonnet-4-6`
- Count: `1x`

10. Quote selection
- Provider: Anthropic
- Call: `generateQuoteSelectionStage(...)`
- Model: `ANTHROPIC_WRITING_MODEL`
- Default: `claude-sonnet-4-6`
- Count: `1x`

11. Quote placement
- Provider: Anthropic
- Call: `generateQuotePlacementStage(...)`
- Model: `ANTHROPIC_WRITING_MODEL`
- Default: `claude-sonnet-4-6`
- Count: `1x`

12. Section plan
- Provider: Anthropic
- Call: `generateSectionPlanStage(...)`
- Model: `ANTHROPIC_WRITING_MODEL`
- Default: `claude-sonnet-4-6`
- Count: `1x`

13. Why it matters
- Provider: Anthropic
- Call: `generateWhyItMattersStage(...)`
- Model: `ANTHROPIC_WRITING_MODEL`
- Default: `claude-sonnet-4-6`
- Count: `1x`

## Full Script-Agent Pipeline

Core file: `src/server/services/script-agent.ts`

Planning side:
- `analogStructure`: Anthropic `claude-sonnet-4-6`
- `fallbackResearch`: Anthropic `claude-sonnet-4-6`
- `researchStrategyDraft`: Anthropic `claude-sonnet-4-6`
- `refinedResearchStrategy`: Anthropic `claude-sonnet-4-6`
- `beat classification / preservation`: Anthropic `claude-sonnet-4-6`
- `sectionQueryPlanning`: Anthropic `claude-sonnet-4-6`
- `Parallel deep memo`: Parallel `pro-fast`

Research side:
- article fact extraction: OpenAI `gpt-4.1-mini`
- transcript quote extraction during section research: OpenAI `gpt-4.1-mini`
- `searchTopic()` quote extraction: off by default unless `includeAiQuotes: true`

Writing side:
- research summary / thesis synthesis: Anthropic `claude-sonnet-4-6`
- outline: Anthropic `claude-sonnet-4-6`
- quote selection: Anthropic `claude-sonnet-4-6`
- quote placement: Anthropic `claude-sonnet-4-6`
- section plans: Anthropic `claude-sonnet-4-6`
- section drafts: Anthropic `claude-sonnet-4-6`
- metadata / assembly / critique / revise / polish: Anthropic `claude-sonnet-4-6`

## Cost Control Changes

1. Opus is no longer allowed in the normal runtime model helpers.
2. Quote extraction no longer uses Anthropic.
3. Direct-report quote extraction is one pass per clip instead of many prompts per clip.
4. `searchTopic()` no longer auto-mines quotes unless explicitly asked.

## Expected Cost Shape

Cheapest steps:
- Parallel search / extract
- OpenAI article fact extraction
- OpenAI transcript quote extraction

Most expensive remaining steps:
- Sonnet planning / writing passes

If costs are still unexpectedly high after this change, the next thing to instrument is exact token logging for:
- `createAnthropicJson(...)`
- `findRelevantQuotes(...)`
- `extractArticleFactsFromMarkdown(...)`
