# Moon Corpus Filter + Script Analysis Plan

## Goal

Use the full Moon back-catalog already in production to rebuild two weak areas:

1. board story filtering and ranking
2. script-line analysis for research / footage search

The current heuristic filter is underfitting the real corpus, so this should move from hand-tuned keywords to a corpus-derived scoring system.

## Key Findings

The production Moon corpus already gives us a strong training/reference set:

- `349` Moon videos in `clip_library`
- `346` full transcripts in `transcript_cache`
- `1,453,833` transcript words
- metadata per clip: title, duration, views, upload date, thumbnail
- `channelOrContributor = "Moon"`
- `metadataJson.isMoonVideo = true`

Current board filter performance is poor against Moon's own catalog.

Corpus evaluation against the current scorer in [moon-relevance.ts](/Users/samuelhylton/Documents/gits/moon-news/src/server/services/board/moon-relevance.ts):

- average title-only score: `4.1`
- average transcript score: `14.9`
- title-only p50: `0`
- transcript p50: `10`
- `211 / 349` Moon videos score below `15`
- `281 / 349` Moon videos score below `30`

That means the current thresholded heuristic is rejecting a large share of real Moon-style topics. This is the main reason story filters feel off.

## Backend Plan (Codex)

### 1. Add a Moon corpus analysis domain

Create a new backend area:

```text
src/server/services/moon-corpus/
src/server/services/moon-corpus/index.ts
src/server/services/moon-corpus/features.ts
src/server/services/moon-corpus/clusters.ts
src/server/services/moon-corpus/analogs.ts
src/server/services/moon-corpus/scorer.ts
src/server/services/moon-corpus/script-analysis.ts
src/trigger/tasks/moon-corpus/
```

Responsibility:

- analyze Moon clips and transcripts
- derive reusable topic/style/format features
- expose scoring helpers for board stories and script lines

### 2. Persist corpus-derived features

Add new tables in [schema.ts](/Users/samuelhylton/Documents/gits/moon-news/src/server/db/schema.ts):

- `moon_video_profiles`
  - one row per Moon clip
  - fields:
    - `clip_id`
    - `title_terms_json`
    - `transcript_terms_json`
    - `named_entities_json`
    - `vertical_guess`
    - `coverage_mode`
    - `style_terms_json`
    - `hook_terms_json`
    - `duration_bucket`
    - `view_percentile`
    - `word_count`
    - `profile_version`
    - `analyzed_at`
- `moon_corpus_terms`
  - corpus-level weighted terms and phrases
  - fields:
    - `term`
    - `term_type`
    - `document_frequency`
    - `weight`
    - `lift`
    - `profile_version`
- `moon_corpus_clusters`
  - reusable topic/angle clusters inferred from the Moon library
  - fields:
    - `cluster_key`
    - `label`
    - `keywords_json`
    - `entity_keys_json`
    - `example_clip_ids_json`
    - `coverage_mode`
    - `profile_version`
- `moon_story_scores`
  - optional cache per board story for explainable Moon-fit scoring
  - fields:
    - `story_id`
    - `moon_fit_score`
    - `cluster_key`
    - `coverage_mode`
    - `analog_clip_ids_json`
    - `reason_codes_json`
    - `scored_at`
    - `profile_version`

This keeps the Moon profile versioned and queryable instead of recomputing everything ad hoc.

### 3. Run a full corpus pass over the 349 Moon videos

Add Trigger jobs:

- `analyze-moon-corpus`
- `refresh-moon-video-profiles`
- `score-board-stories-with-moon-corpus`

Job behavior:

1. load all `clip_library` rows where `channelOrContributor = 'Moon'`
2. join transcript text and segments from `transcript_cache`
3. extract title terms, transcript phrases, entities, hook patterns, controversy terms, institutional/failure patterns, culture-war patterns, biography patterns, and documentary angle types
4. assign rough cluster + coverage mode for each video
5. compute reusable corpus term weights and cluster exemplars
6. persist profiles and cluster data
7. rescore all board stories against that reference set

### 4. Replace the current Moon relevance heuristic for board stories

Target file: [moon-relevance.ts](/Users/samuelhylton/Documents/gits/moon-news/src/server/services/board/moon-relevance.ts)

Instead of relying mainly on manual keyword weights, build a scorer that combines:

- title overlap with high-lift Moon terms
- transcript/body overlap with high-lift Moon terms
- entity overlap with Moon clusters
- coverage-mode similarity
- controversy/institutional-failure/social-commentary signals
- nearest-analog similarity to real Moon videos
- corpus recency weighting, with Moon videos from the last 3 months carrying a 5x multiplier and then decaying by age
- recency and board-story score as a secondary factor, not the main Moon-fit signal

New scorer output should include:

- `moonFitScore`
- `moonFitBand` (`high`, `medium`, `low`)
- `moonCluster`
- `coverageMode`
- `analogClipIds`
- `analogTitles`
- `reasonCodes`
- `disqualifierCodes`

### 5. Upgrade story list filtering and sorting

Target API: [route.ts](/Users/samuelhylton/Documents/gits/moon-news/src/app/api/board/stories/route.ts)

Extend `GET /api/board/stories` filters with:

- `moonFitBand`
- `moonCluster`
- `coverageMode`
- `vertical`
- `hasAnalogs`
- `minMoonFitScore`
- `sort=moonFit|storyScore|controversy|recency|analogs|views`

Extend list response rows from [index.ts](/Users/samuelhylton/Documents/gits/moon-news/src/server/services/board/index.ts) to include:

- `moonFitScore`
- `moonFitBand`
- `moonCluster`
- `coverageMode`
- `analogTitles`
- `analogMedianViews`
- `analogMedianDurationMinutes`
- `reasonCodes`

This gives the UI much narrower, explainable story filters instead of a single weak generic relevance score.

### 6. Upgrade story detail with Moon analogs

Target API: `GET /api/board/stories/:storyId`

Add a Moon-analysis block to the story detail payload:

- top matching Moon videos
- why they matched
- dominant cluster
- likely format fit
- likely title/hook patterns
- typical duration/view benchmarks from matching analogs

This gives editors a better answer than “is this vaguely Moon-relevant?” It answers “what kind of Moon video is this most like?”

### 7. Upgrade the script analysis tool

Current issue:

[openai.ts](/Users/samuelhylton/Documents/gits/moon-news/src/server/providers/openai.ts) only classifies script lines for footage search categories. It does not use Moon's own corpus.

Target changes:

- expand `classifyLine(...)` into a richer Moon-aware analysis contract
- use Moon corpus features to improve keyword generation and visual strategy

New output fields should include:

- `moon_story_fit`
- `likely_vertical`
- `coverage_mode`
- `analog_clip_ids`
- `analog_titles`
- `hook_style`
- `expected_visual_mix`
- `primary_entities`
- `secondary_entities`
- `search_keywords`
- `archive_keywords`
- `youtube_keywords`
- `ai_generation_recommended`
- `ai_generation_reason`

Wire this into [investigation.ts](/Users/samuelhylton/Documents/gits/moon-news/src/server/services/investigation.ts) so line investigation gets:

- better search keywords
- better archive / YouTube search pivots
- more precise AI generation suggestions
- analog-aware visual recommendations

### 8. Add corpus-backed search helpers for research

Add helper endpoints/services to support future UI and research flows:

- `GET /api/moon-corpus/clusters`
- `GET /api/moon-corpus/analogs?storyId=...`
- `GET /api/moon-corpus/analogs?lineId=...`
- `POST /api/moon-corpus/rebuild`

These should make it easy to inspect the corpus model, not just use it implicitly.

### 9. Keep the first implementation statistical + rules-based

Do not make v1 depend on embeddings infrastructure or a separate vector DB.

Use:

- token/phrase lift
- entity overlap
- profile/cluster similarity
- analog voting
- OpenAI only where useful for normalization or cluster labeling

This keeps it cheap and deployable inside the current stack.

## Frontend Plan (Claude)

Claude should build against the new API fields once backend is ready.

### Board filters

Update `/board` story controls to expose:

- `Moon Fit`: high / medium / low
- `Cluster`
- `Coverage Mode`
- `Has Analogs`
- `Sort by Moon Fit`

### Story cards

Show compact explainers:

- Moon-fit badge
- cluster label
- top 1-2 analog titles
- short reason chips from `reasonCodes`

### Story detail panel

Add a `Moon Analogs` section with:

- top matching Moon videos
- benchmark duration/views
- matched terms/entities
- suggested angle / format

### Script workspace

Where script-line analysis is surfaced, add:

- likely Moon angle
- best analog clips
- improved provider-specific search keywords
- stronger AI-generation guidance

## Execution Order

### Phase 1

- add schema for corpus profiles and score cache
- add corpus analysis services
- run the first 349-video analysis pass
- persist profiles and clusters

### Phase 2

- replace board Moon filter/scorer
- extend `GET /api/board/stories`
- extend `GET /api/board/stories/:storyId`
- expose Moon analog data and explainers

### Phase 3

- upgrade script-line analysis contract
- update investigation pipeline to use Moon-aware search terms and analogs

### Phase 4

- Claude wires the new filters and story-detail affordances into `/board`
- Claude wires Moon-aware analysis into the script workspace UI

## Expected Outcome

After this work, the board should stop behaving like a generic controversy/news filter and start behaving like a Moon-specific editorial selector.

Success criteria:

- real Moon videos no longer score poorly under the Moon filter
- story lists can be narrowed by actual Moon-style topic clusters and coverage modes
- story detail shows useful analogs from Moon's own history
- script analysis produces better research keywords and visual plans because it understands what kind of Moon story the line belongs to
