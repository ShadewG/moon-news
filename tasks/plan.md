# Moon News Studio — Implementation Plan

## Phase 1: CIA Terminal UI (Claude — NOW)
Rebuild the board-client.tsx with the FOIA researcher aesthetic:
- Ultra-dark (#080808), monospace (11px), data-dense
- Stats bar with pipes `|` as separators
- Compact rows instead of cards
- Tags as small colored pills
- Running task indicators with elapsed time
- Filter bar with dropdowns
- View tabs (board | queue | competitors | sources)
- Right panel with research results

## Phase 2: Deep Research Pipeline (Codex — Backend)
Adapt the FOIA researcher's multi-source parallel search for news stories.

### Tasks for Codex:

**Task 1: Multi-source news search service**
File: `src/server/services/board/news-search.ts`
- Create a `searchNewsStory(query, mode)` function
- Mode: "quick" (2 sources, 8 results) vs "full" (5+ sources, 30 results)
- Sources to search in parallel:
  - Serper API (Google search) — add SERPER_API_KEY to env
  - Perplexity Sonar API — add PERPLEXITY_API_KEY to env
  - Google News RSS (free, no key)
  - Hacker News API (free)
  - Reddit search API (free)
  - Our existing: YouTube, Twitter/X (xAI Grok), Internet Archive
- Deduplicate results by URL (canonicalize: strip tracking params, lowercase host)
- Return: array of { title, url, source, snippet, publishedAt, relevanceScore }

**Task 2: Content extraction with fallback chain**
File: `src/server/services/board/content-extractor.ts`
- Create `extractArticleContent(url)` with fallback:
  1. Try Firecrawl (existing)
  2. Fallback to direct fetch + HTML parsing (regex-based, strip tags, get main content)
  3. Fallback to Perplexity "summarize this URL"
- Return: { title, content, author, publishedAt, siteName }
- Cache extracted content in a new `extracted_content_cache` table (keyed by URL hash)

**Task 3: Story synthesis (GPT deep research)**
File: `src/server/services/board/story-research.ts`
- Create `deepResearchStory(storyId, mode)` function
- Steps:
  1. Get all feed items linked to the story
  2. Run `searchNewsStory()` with story title/keywords
  3. Extract content from top 15-30 results (parallel, semaphore 5)
  4. Synthesize with OpenAI: structured output with
     - summary (3 paragraphs)
     - timeline (key events with dates)
     - key_players (people/orgs involved)
     - controversy_score (0-100)
     - format_suggestion (Full Video / Short / Both)
     - angle_suggestions (3 documentary angles)
     - title_options (5 clickable titles)
     - script_opener (first paragraph of script)
  5. Save result to board_story_ai_outputs
  6. Update story score based on research findings
- Emit progress events for live tracking

**Task 4: Story scoring algorithm**
File: `src/server/services/board/story-scorer.ts`
- Adapt the FOIA case_evaluator.py scoring for news stories:
  - Source Score (30pts): source_count × 3, capped at 30. Bonus for tier-1 sources (NYT, Reuters, AP)
  - Controversy Score (25pts): sentiment polarity × engagement metrics
  - Timeliness Score (20pts): recency bonus (breaking = 20, today = 15, this week = 10, older = 5)
  - Competitor Overlap (15pts): +15 if competitors are covering it, +10 if adjacent
  - Visual Evidence Score (10pts): +10 if video exists, +5 if images, +3 if infographics
- Surge detection: if velocity (items/hour) > 3× 7-day baseline, flag as surge
- Return: { totalScore, breakdown, tier (S/A/B/C/D), surgeActive }

**Task 5: Live progress streaming**
File: `src/server/services/board/progress.ts`
- Create a progress event system for long-running research
- Store progress in a `research_progress` table:
  - task_id, step (searching | extracting | synthesizing | scoring),
  - progress (0-100), message, started_at, updated_at
- API endpoint: `GET /api/board/stories/:id/progress` (poll every 2s)
- Steps to track:
  1. searching (0-20%) — querying news sources
  2. extracting (20-50%) — pulling full content from URLs
  3. synthesizing (50-80%) — AI generating summary/analysis
  4. scoring (80-90%) — calculating story score
  5. complete (100%) — done

**Task 6: Extracted content cache table**
Migration for:
```sql
CREATE TABLE extracted_content_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url_hash text NOT NULL UNIQUE,
  url text NOT NULL,
  title text,
  content text NOT NULL,
  author text,
  published_at text,
  site_name text,
  word_count integer DEFAULT 0,
  extracted_at timestamptz DEFAULT now()
);
CREATE INDEX idx_ecc_url_hash ON extracted_content_cache(url_hash);
```

**Task 7: Research progress table**
Migration for:
```sql
CREATE TABLE research_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid REFERENCES board_story_candidates(id) ON DELETE CASCADE,
  task_type text NOT NULL DEFAULT 'deep_research',
  step text NOT NULL DEFAULT 'pending',
  progress integer NOT NULL DEFAULT 0,
  message text,
  metadata_json jsonb,
  started_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_rp_story ON research_progress(story_id);
```

### Environment variables to add:
```
SERPER_API_KEY=       # serper.dev — Google search API
PERPLEXITY_API_KEY=   # Perplexity Sonar — AI search
```

## Phase 3: Board UI Features (Claude — After Phase 2)
- Wire deep research into the board UI
- Live progress tracker (like FOIA's ResearchLiveTracker)
- Research results modal with tabs (Summary | Sources | Timeline | Clips)
- "Find Footage" button → topic search in clip library
- Notion export integration (if needed)

## Phase 4: Recurring Automation (Codex — Backend)
- Trigger.dev scheduled tasks:
  - `poll-rss-feeds` — every 15 min
  - `poll-competitors` — every 15 min
  - `score-stories` — after each poll cycle
  - `detect-surges` — compare velocity to baseline
  - `refresh-ticker` — update ticker alerts
- Auto-research: when a story hits score > 80, auto-trigger quick research

## Phase 5: Cross-tool Integration
- Board → Library: "Find Footage" opens topic search with story keywords
- Library → Board: clips/quotes can be linked to board stories
- Shared nav: `/board` ←→ `/library` ←→ `/clips/:id`
- Global Cmd+K search across stories + clips + quotes
