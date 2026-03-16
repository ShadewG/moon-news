# Moon News Board Plan

## Goal

Build a second product surface inside this repo: a live editorial board for story discovery, controversy tracking, competitor monitoring, and queueing stories into production.

The supplied board spec in `/Users/samuelhylton/Documents/moon-news-board (1).html` defines these core views:

- Story Board
- Controversy Feed
- Video Queue
- Competitor Activity
- Sources
- Right-side research/action panel with `Brief Me`, `Script Starter`, `Title Generator`, and `Add to Queue`
- Feed health, ticker alerts, and AI cost/status indicators

This is not the same thing as the current script-line workspace. It should be treated as a separate workflow that feeds the existing video-production flow.

## Architecture Decisions

### Repo and app shape

- Keep this in the same repo and the same Next.js app.
- Add a new route namespace for the board, likely `/board`.
- Reuse the current `moon-news-web` app service and `moon-news-worker` Trigger worker.

### Railway services

- Do **not** add a brand new always-on RSS service first.
- Use scheduled Trigger.dev tasks for RSS polling, YouTube RSS polling, RSS.app/X ingestion, Apify trend pulls, and periodic recomputation.
- Only split into a dedicated `moon-news-feeds` service later if ingestion becomes too heavy or needs long-running browser workers.

### Database decision

- Use the **same Railway Postgres** initially.
- Keep the board data isolated with a separate table namespace or schema, e.g. `board_*`.
- Do **not** create a second database yet.

Why:

- the board will need to link into the existing clip library, project system, and eventually create production projects
- one DB keeps joins and workflow handoffs simple
- the current scale does not justify a second operational surface

When to split later:

- if feed items grow into high millions
- if retention windows for board ingestion diverge heavily from production data
- if ingest/write load starts affecting video workspace latency

## Backend Plan (Codex)

Codex owns backend, data model, scheduled ingestion, scoring, APIs, and handoff into the existing production system.

### 1. New board domain

Add a new backend domain under:

```text
src/server/services/board/
src/server/providers/board/
src/app/api/board/
src/trigger/tasks/board/
```

### 2. Data model

Use a separate board namespace in the same DB.

Recommended tables:

- `board_sources`
  - one row per configured source/feed
  - fields: `id`, `name`, `kind`, `provider`, `poll_interval_minutes`, `enabled`, `config_json`, `last_polled_at`, `last_success_at`, `last_error`
- `board_feed_items`
  - raw ingested items from RSS, YouTube RSS, RSS.app/X, Apify, Google Alerts-like sources
  - fields: `id`, `source_id`, `external_id`, `title`, `url`, `author`, `published_at`, `summary`, `content_hash`, `metadata_json`, `ingested_at`
- `board_story_candidates`
  - deduplicated cluster-level story rows shown on the board
  - fields: `id`, `canonical_title`, `vertical`, `status`, `story_type`, `surge_score`, `controversy_score`, `sentiment_score`, `items_count`, `sources_count`, `first_seen_at`, `last_seen_at`, `score_json`
- `board_story_sources`
  - joins candidates to feed items / evidence
  - fields: `id`, `story_id`, `feed_item_id`, `source_weight`, `is_primary`, `evidence_json`
- `board_story_ai_outputs`
  - cached AI artifacts for a story
  - fields: `id`, `story_id`, `kind`, `prompt_version`, `model`, `content`, `metadata_json`, `created_at`
  - `kind` values: `brief`, `script_starter`, `titles`
- `board_competitor_channels`
  - configured competitor channels/accounts
  - fields: `id`, `name`, `platform`, `tier`, `handle`, `channel_url`, `poll_interval_minutes`, `enabled`, `metadata_json`
- `board_competitor_posts`
  - latest uploads/posts per competitor
  - fields: `id`, `channel_id`, `external_id`, `title`, `url`, `published_at`, `views`, `engagement_json`, `topic_match_score`, `alert_level`
- `board_queue_items`
  - editorial queue / pipeline board
  - fields: `id`, `story_id`, `position`, `status`, `format`, `target_publish_at`, `assigned_to`, `notes`, `linked_project_id`, `created_at`, `updated_at`
- `board_ticker_events`
  - precomputed ticker items
  - fields: `id`, `story_id`, `label`, `text`, `priority`, `starts_at`, `expires_at`

### 3. Ingestion pipeline

Build scheduled Trigger tasks instead of a separate Railway service first.

Recommended tasks:

- `pollBoardRssSources`
- `pollBoardYoutubeRss`
- `pollBoardTwitterRssApp`
- `pollBoardApifyTrends`
- `pollBoardCompetitors`
- `clusterBoardStories`
- `scoreBoardStories`
- `refreshBoardTicker`
- `refreshBoardCompetitorAlerts`

Polling cadence:

- RSS / YouTube RSS / RSS.app: every 15 minutes
- Apify trends: every 30 to 60 minutes
- clustering + scoring: after each ingest batch and as a periodic cleanup

### 4. Story clustering and scoring

Codify the scoring that the HTML implies.

Initial scoring inputs:

- recency
- source count
- source authority
- cross-source agreement
- competitor overlap
- X/Twitter velocity
- controversy score
- sentiment intensity
- correction/update events
- format suitability (`Full Video`, `Short`, or both)

Persist component scores in `score_json` so frontend can explain why a story is ranked high.

### 5. API surface

Add board-specific APIs:

- `GET /api/board/stories`
  - filters: `view=board|controversy`, `status`, `storyType`, `search`
- `GET /api/board/stories/:storyId`
  - full story detail, sources, metrics, AI cache
- `POST /api/board/stories/:storyId/brief`
  - generate or return cached briefing
- `POST /api/board/stories/:storyId/script-starter`
  - generate or return cached script opener
- `POST /api/board/stories/:storyId/titles`
  - generate or return cached titles
- `POST /api/board/stories/:storyId/queue`
  - add to video queue
- `POST /api/board/stories/:storyId/create-project`
  - create a production project in the existing workspace flow
- `GET /api/board/queue`
- `PATCH /api/board/queue/:queueItemId`
- `GET /api/board/competitors`
- `GET /api/board/sources`
- `GET /api/board/health`
- `GET /api/board/ticker`

### 6. AI tools

Use cached generation, not synchronous repeated calls from the UI.

- `Brief Me`
  - grounded summary from the story’s normalized sources
- `Script Starter`
  - opening paragraph / hook in Moon style
- `Title Generator`
  - 5-10 titles, optionally bucketed by aggressive vs safer CTR style

Rules:

- cache by `story_id + kind + prompt_version`
- invalidate when a story gains meaningful new evidence
- store token/cost metadata for the sidebar cost stats

### 7. Handoff into the current production app

This board should feed the existing Moon News workflow.

Backend handoff path:

- `board_story_candidate`
- `board_queue_item`
- optional `create-project` action
- link `linked_project_id` to the existing `projects` table

That lets a story move from discovery to an actual script/footage research project.

### 8. Phase order

#### Phase 1

- schema
- ingestion tasks
- story clustering
- `GET /api/board/stories`
- `GET /api/board/health`
- `GET /api/board/ticker`

#### Phase 2

- story detail API
- `Brief Me`
- `Title Generator`
- queue APIs
- competitor polling

#### Phase 3

- `Script Starter`
- create-project handoff into existing workspace
- cached cost metrics
- correction/update handling

## Frontend Plan (Claude)

Claude owns the new board UI route, layout, interaction model, and integration with the new board APIs.

### 1. New route

Add a dedicated route:

- `/board`

This should not replace the current `/` production workspace.

### 2. Layout

Build the shell from the HTML spec:

- ticker
- left sidebar
- top tabs/filter strip
- main center pane
- right detail/action panel

Views to implement:

- Story Board
- Controversy Feed
- Video Queue
- Competitor Activity
- Sources

### 3. Data flow

Frontend should not embed fake story arrays once the backend exists.

Use server/client composition like:

- SSR initial fetch for `/board`
- client polling or revalidation for health/ticker/queue deltas
- detail panel fetch on story selection

### 4. UI responsibilities

- filters for board vs controversy vs competitor-sensitive stories
- story card ranking and badges
- right panel source list and metrics
- queue view with stage pills
- competitor cards
- sources catalog grid
- optimistic UX for `Add to Queue`

### 5. API integration

Claude should consume these backend contracts:

- `GET /api/board/stories`
- `GET /api/board/stories/:storyId`
- `POST /api/board/stories/:storyId/brief`
- `POST /api/board/stories/:storyId/script-starter`
- `POST /api/board/stories/:storyId/titles`
- `POST /api/board/stories/:storyId/queue`
- `GET /api/board/queue`
- `GET /api/board/competitors`
- `GET /api/board/sources`
- `GET /api/board/health`
- `GET /api/board/ticker`

### 6. Frontend phase order

#### Phase 1

- static route and shell
- story board view
- controversy feed view
- right panel

#### Phase 2

- video queue view
- competitor view
- sources view
- ticker and health indicators

#### Phase 3

- AI action integration
- create-project / queue action polish
- URL state for selected story and filters

## Shared Contracts

These need to stay explicit between backend and frontend:

- story status enum
- story type enum
- queue status enum
- source/provider enum
- score breakdown shape
- AI output payloads

Frontend should render from backend-owned normalized data, not recreate business logic locally.

## Recommended Initial Infra Scope

Start with:

- same Next.js app
- same Railway Postgres
- same Trigger worker
- new `board_*` tables
- scheduled ingestion tasks

Do **not** start with:

- a second Postgres database
- a separate RSS microservice
- real-time websockets

Those are valid later, but they are not the right first move.

## First Build Slice

Codex:

1. add `board_*` schema
2. add scheduled Trigger ingestion tasks
3. add story clustering/scoring service
4. add `/api/board/stories`, `/api/board/health`, `/api/board/ticker`

Claude:

1. build `/board`
2. implement shell and story board view
3. wire story detail panel to the new APIs

That gets the new board live quickly without blocking on the full queue + competitor + AI tool stack.
