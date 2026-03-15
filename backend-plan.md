# Moon News Backend Plan

## Goal

Build the first real backend for Moon News inside the existing Next.js app, with long-running work handled by Trigger.dev and infrastructure deployed on Railway.

This plan is based on the current frontend prototype in:

- `src/app/page.tsx`
- `src/components/*`
- `src/lib/sample-data.ts`

The UI already defines the backend shape:

- a `project`
- a versioned `script`
- many `script lines`
- research results per line
- footage results per line
- generated image/video assets per line
- timeline selections
- export jobs

## Locked Decisions

### App and infra

- App runtime: `Next.js` in the existing repo
- API layer: `Next.js Route Handlers`
- Database: `Postgres` on Railway
- Background jobs: `Trigger.dev`
- Hosting: `Railway`
- Persistent media storage: `Railway volumes`

### Providers

#### Research
- Primary research engine: `Parallel`
- Deep research / provenance investigation: `Perplexity Sonar Deep Research`
- Web extraction and page parsing: `Firecrawl`
- Main LLM: `OpenAI`
- Secondary image model: `Gemini`

#### Footage and media discovery
- Stock footage: `Storyblocks`
- Additional stock footage: `Artlist` if account/API access supports it
- YouTube search: `YouTube Data API v3`
- Editorial / news footage: `Getty Images API`
- Public domain / archival footage: `Internet Archive API`
- Reference image search: `Google Custom Search API` (image search mode)
- Music: `Artlist`

#### Generation and transcription
- Transcript provider: `ElevenLabs STT`
- YouTube transcript extraction: `youtube-transcript-api` (for YT source clips)
- Video generation provider: `OpenAI`
- Secondary video providers available from existing envs: `Runway`, `Kling`
- Image generation provider: `OpenAI` first, `Gemini` second
- Experimental model gateway available from existing envs: `Fal`
- Editorial review handoff available from existing envs: `Frame.io`

## Opinionated Notes

- Do not split the backend into a separate API service yet. Keep the backend-for-frontend pattern inside the Next.js app until the product is clearly constrained by scale.
- Do not send long-running provider calls from request handlers. Every research, ingestion, and generation workflow should be a Trigger task.
- Railway volumes are acceptable for v1 because you explicitly want them, but they create constraints:
  - single-region asset access
  - no built-in CDN behavior
  - harder migration path if asset throughput grows
  - backups and replication need to be handled intentionally
- Railway does not currently let this project mount one shared volume across both `moon-news-web` and `moon-news-worker`, so assume separate per-service volumes unless and until media moves to object storage.
- Because of that, volumes should be treated as the source of persisted generated files and cached provider downloads for v1, not as a permanent final-state media architecture.

## Railway Topology

Create a dedicated Railway project for this repo instead of reusing the currently linked `Autobot` project.

### Services

1. `moon-news-web`
   - Next.js app
   - serves frontend and route handlers
   - mounts volume at `/data/media`

2. `moon-news-db`
   - Railway Postgres service

3. `moon-news-worker`
   - Trigger.dev worker runtime
   - can live as its own service or share the repo with a separate root/start command
   - in the current Railway setup, it cannot share the exact same volume instance as `moon-news-web`
   - if local media access is required by job steps, either mirror the directory layout on a second worker volume or move cross-service assets behind route handlers/object storage

4. `moon-news-redis` (optional)
   - only add if a queue/cache need emerges outside Trigger.dev
   - not required for the first slice

### Volume layout

Mount path:

```text
/data/media
```

Suggested directories:

```text
/data/media/projects/<projectId>/uploads
/data/media/projects/<projectId>/research-cache
/data/media/projects/<projectId>/storyblocks
/data/media/projects/<projectId>/artlist
/data/media/projects/<projectId>/youtube
/data/media/projects/<projectId>/getty
/data/media/projects/<projectId>/internet-archive
/data/media/projects/<projectId>/google-images
/data/media/projects/<projectId>/images
/data/media/projects/<projectId>/videos
/data/media/projects/<projectId>/audio
/data/media/projects/<projectId>/exports
```

In the current deployed Railway project, keep the same directory layout on both service volumes if both services need filesystem access. Do not assume writes from web are visible to worker without an explicit sync or download step.

## Code Layout

Add these server-side areas:

```text
src/app/api/
src/server/config/
src/server/db/
src/server/domain/
src/server/providers/
src/server/services/
src/server/storage/
src/server/trigger/
```

Suggested responsibility split:

- `config`: env parsing and runtime guards
- `db`: Drizzle schema, migrations, db client
- `domain`: shared business types and status enums
- `providers`: thin SDK wrappers for Parallel, Perplexity, Firecrawl, OpenAI, Gemini, Runway, Kling, Fal, Storyblocks, Artlist, YouTube, Getty, InternetArchive, GoogleImages, ElevenLabs, Frame.io
- `services`: orchestration helpers used by route handlers and tasks
- `storage`: volume path helpers, file metadata, cleanup helpers
- `trigger`: task definitions and task-trigger helpers

## Database Model

Use a normalized schema. The frontend currently reads denormalized sample objects, but the backend should store runs and assets separately.

### Core tables

- `projects`
  - `id`
  - `title`
  - `slug`
  - `status`
  - `created_at`
  - `updated_at`

- `script_versions`
  - `id`
  - `project_id`
  - `version_number`
  - `raw_script`
  - `created_at`

- `script_lines`
  - `id`
  - `project_id`
  - `script_version_id`
  - `line_key`
  - `line_index`
  - `timestamp_start_ms`
  - `duration_ms`
  - `text`
  - `line_type`
  - `research_status`
  - `footage_status`
  - `image_status`
  - `video_status`
  - `created_at`
  - `updated_at`

- `project_stats`
  - materialized or computed view
  - can be delayed until after the first API slice

### Research tables

- `research_runs`
  - `id`
  - `project_id`
  - `script_line_id`
  - `provider` — enum: `parallel`, `perplexity`
  - `status`
  - `query`
  - `provider_job_id` — external job/request ID from the provider
  - `started_at`
  - `completed_at`
  - `error_message`

- `research_sources`
  - `id`
  - `research_run_id`
  - `script_line_id`
  - `title`
  - `source_name`
  - `source_url`
  - `published_at`
  - `snippet`
  - `extracted_text_path`
  - `relevance_score`
  - `source_type`
  - `citation_json`

- `research_summaries`
  - `id`
  - `research_run_id`
  - `script_line_id`
  - `summary`
  - `confidence_score`
  - `model`

### Media discovery tables

- `footage_search_runs`
  - `id`
  - `project_id`
  - `script_line_id`
  - `provider` — enum: `storyblocks`, `artlist`, `youtube`, `getty`, `internet_archive`, `google_images`
  - `status`
  - `query`
  - `started_at`
  - `completed_at`
  - `error_message`

- `footage_assets`
  - `id`
  - `footage_search_run_id`
  - `script_line_id`
  - `provider` — enum: `storyblocks`, `artlist`, `youtube`, `getty`, `internet_archive`, `google_images`
  - `external_asset_id`
  - `title`
  - `preview_url`
  - `source_url` — canonical URL for the asset on the provider's platform
  - `license_type`
  - `price_label`
  - `duration_ms`
  - `width`
  - `height`
  - `match_score`
  - `is_primary_source` — boolean, true if asset comes from a primary source provider (archive, wire service, original uploader)
  - `upload_date` — original upload/publish date from provider, used for provenance ranking
  - `channel_or_contributor` — uploader name / channel / photographer credit
  - `metadata_json`

- `music_assets`
  - same pattern as `footage_assets`
  - only needed once soundtrack selection starts

### Transcript tables

- `transcript_jobs`
  - `id`
  - `project_id`
  - `script_line_id`
  - `provider`
  - `status`
  - `input_media_path`
  - `started_at`
  - `completed_at`
  - `error_message`

- `transcripts`
  - `id`
  - `transcript_job_id`
  - `script_line_id`
  - `full_text`
  - `language_code`
  - `speaker_count`
  - `words_json`
  - `segments_json`

### Generation tables

- `image_generation_jobs`
  - `id`
  - `project_id`
  - `script_line_id`
  - `provider`
  - `status`
  - `prompt`
  - `style_label`
  - `model`
  - `progress`
  - `started_at`
  - `completed_at`
  - `error_message`

- `video_generation_jobs`
  - `id`
  - `project_id`
  - `script_line_id`
  - `provider`
  - `status`
  - `prompt`
  - `style_label`
  - `model`
  - `source_image_asset_id`
  - `progress`
  - `started_at`
  - `completed_at`
  - `error_message`

- `generated_assets`
  - `id`
  - `project_id`
  - `script_line_id`
  - `job_type`
  - `job_id`
  - `provider`
  - `asset_kind`
  - `file_path`
  - `mime_type`
  - `duration_ms`
  - `width`
  - `height`
  - `metadata_json`

### Editorial and export tables

- `timeline_items`
  - `id`
  - `project_id`
  - `script_line_id`
  - `track_type`
  - `asset_type`
  - `asset_id`
  - `start_ms`
  - `end_ms`
  - `layer_index`
  - `selected`

- `exports`
  - `id`
  - `project_id`
  - `status`
  - `output_path`
  - `format`
  - `resolution`
  - `started_at`
  - `completed_at`
  - `error_message`

## API Surface

All expensive operations should return quickly with a persisted job record and a task trigger result.

### Project and script

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `POST /api/projects/:projectId/script/import`
- `PATCH /api/projects/:projectId/script/lines/:lineId`

### Research

- `POST /api/projects/:projectId/lines/:lineId/research`
  - creates `research_runs`
  - triggers Trigger task

- `GET /api/projects/:projectId/lines/:lineId/research`
  - returns latest run plus normalized sources and summary

- `POST /api/projects/:projectId/research/all`
  - bulk enqueues missing line research

### Footage and music

- `POST /api/projects/:projectId/lines/:lineId/footage-search`
  - accepts optional `providers` array to limit which providers to search (default: all enabled)
  - triggers `searchFootageTask` which fans out to provider-specific tasks
- `GET /api/projects/:projectId/lines/:lineId/footage`
  - accepts optional `provider` query param to filter by provider
  - returns results ranked by `match_score` with `is_primary_source` flag
- `POST /api/projects/:projectId/lines/:lineId/music-search`
- `GET /api/projects/:projectId/lines/:lineId/music`

### Reference images

- `POST /api/projects/:projectId/lines/:lineId/image-search`
  - triggers Google Images search for reference material
- `GET /api/projects/:projectId/lines/:lineId/reference-images`

### Transcripts

- `POST /api/projects/:projectId/lines/:lineId/transcribe`
- `GET /api/projects/:projectId/lines/:lineId/transcript`

### Generation

- `POST /api/projects/:projectId/lines/:lineId/generate-image`
- `GET /api/projects/:projectId/lines/:lineId/images`
- `POST /api/projects/:projectId/lines/:lineId/generate-video`
- `GET /api/projects/:projectId/lines/:lineId/videos`

### Timeline and export

- `GET /api/projects/:projectId/timeline`
- `PATCH /api/projects/:projectId/timeline`
- `POST /api/projects/:projectId/exports`
- `GET /api/projects/:projectId/exports/:exportId`

### Job status

- `GET /api/jobs/:jobId`
  - unified status endpoint for polling

## Provider Responsibilities

### Parallel

Use for:

- generating grounded web research queries
- retrieving ranked results for a line
- optionally generating broader per-project research batches

Do not use it as the only source of persisted evidence. Every retained citation should be normalized into `research_sources`.

### Firecrawl

Use for:

- extracting structured text from URLs returned by Parallel
- pulling cleaner page content than generic scraping
- capturing structured metadata for citations and evidence storage

Recommended pattern:

1. Parallel finds candidate URLs.
2. Firecrawl extracts page text and metadata for the best URLs.
3. OpenAI summarizes and scores the extracted evidence.

### OpenAI

Use for:

- synthesis of research findings into summaries
- structured extraction or repair when provider output is noisy
- image generation
- video generation
- prompt rewriting for image/video quality

Do not use OpenAI search as the main research layer in this stack because `Parallel` is already the chosen primary research engine.

### Gemini

Use for:

- alternate image generation path
- fallback or comparative generation
- image refinement when OpenAI results are weak

Keep Gemini out of the critical path for v1 unless there is a specific quality gap in OpenAI outputs.

### Storyblocks

Use for:

- stock footage search
- preview metadata
- candidate selection for timeline

### Artlist

Use for:

- soundtrack/music search and selection
- footage search only if the API account and catalog access expose the required search and licensing workflow

This is an implementation checkpoint. Before making Artlist a first-class footage provider, verify:

- searchable footage catalog via API
- preview asset access
- license metadata access
- commercial usage flow compatible with automation

If any of those are missing, keep Artlist music-only in v1.

### Perplexity Sonar Deep Research

Use for:

- complex provenance investigation when standard Parallel results are inconclusive
- multi-step research that requires following chains of references across sources
- verifying whether a piece of footage is the original or a repost by tracing publication history
- generating comprehensive background context for editorial lines that cover multi-decade timelines

Perplexity Deep Research autonomously performs 20+ searches, reads pages, evaluates sources, and synthesizes findings. At ~$5 per request it is expensive, so use it selectively — not on every line. Reserve it for lines where Parallel returns ambiguous or low-confidence results, or where provenance verification is critical.

Do not use Perplexity as the primary research engine. Use Parallel first, then escalate to Perplexity when deeper investigation is needed.

### YouTube Data API v3

Use for:

- searching YouTube for primary source footage (congressional hearings, news broadcasts, documentary clips, press conferences)
- retrieving video metadata including upload date, channel info, view count, and description
- identifying original uploads vs reposts by comparing upload dates and channel authority
- fetching video thumbnails for preview display

Key constraints:

- free tier gives 10,000 quota units/day
- `search.list` costs 100 units per call (~100 searches/day)
- `videos.list` costs 1 unit per call (use to get full metadata after search)
- max 50 results per search request
- if volume grows beyond free tier, fall back to DataForSEO YouTube SERP API at $0.0006/query

Provenance strategy for YouTube results:

1. Search by line text keywords
2. Fetch full video metadata via `videos.list`
3. Prefer results from verified/official channels (news orgs, C-SPAN, government)
4. Rank by upload date (earliest = more likely original)
5. Flag videos from re-upload channels or compilation channels as `is_primary_source: false`

For transcript extraction from YouTube source clips, use the `youtube-transcript-api` Python library (free, no API key needed) rather than consuming YouTube API quota.

### Getty Images API

Use for:

- editorial and news footage with strong provenance metadata
- photographer/videographer credits and capture dates
- news, sports, entertainment, and historical archival content
- high-confidence original source footage (Getty contributors are vetted professionals and agencies)

Getty has the strongest provenance story of any commercial footage provider. Every asset includes contributor attribution, date captured, and editorial context. All Getty editorial content is definitionally primary source.

Key constraints:

- enterprise pricing, requires sales contact for API access
- API v3 with SDKs available
- editorial content is restricted to non-promotional use — respect license boundaries

Always set `is_primary_source: true` for Getty editorial footage. For Getty creative/stock footage, set based on whether the content is editorial or staged.

### Internet Archive API

Use for:

- public domain and Creative Commons archival footage
- Prelinger Archives collection (~9,600 digitized historical/educational/industrial films)
- primary source historical materials guaranteed to be original
- zero-cost footage discovery

The Internet Archive is a preservation institution. Content in their archive is either the original digitization or the canonical preserved copy. This makes it one of the most reliable sources for provenance.

Key constraints:

- free, no authentication required for reads
- rate-limited (500+ reads/sec for metadata, lower for media downloads)
- Search API, Metadata Read API, and S3-like download API available
- resolution varies (some content is 4K/5K restored, some is lower quality archival)

Always set `is_primary_source: true` for Internet Archive footage. Prefer Prelinger Archives results for historical B-roll.

### Google Custom Search API (Image Search)

Use for:

- finding reference images related to script line topics
- discovering editorial photographs that could inform AI image generation prompts
- locating visual assets from news sites, government pages, and educational sources
- building visual mood boards per script line

Key constraints:

- requires a Programmable Search Engine (PSE) configured for image search
- 100 free queries/day, then $5 per 1,000 queries
- returns image URL, source page URL, title, snippet, and image dimensions
- does not provide provenance metadata — use source URL domain to infer originality

Google Images results should be treated as reference material, not as directly usable footage. Use them to:

1. Inform AI image generation prompts (visual style, composition)
2. Find editorial photos that could be licensed separately
3. Discover source pages that may contain embedded video

Do not download and use Google Images results directly without verifying license. Set `is_primary_source` based on the source domain (e.g., `.gov`, `.edu`, AP, Reuters = true).

### ElevenLabs

Use for:

- transcript ingestion for source media
- word-level timestamps
- speaker diarization where useful

### Runway

Use for:

- optional secondary video generation when OpenAI output quality is weak
- style-specific motion generation experiments for lines that need a more cinematic pass
- fallback runs on manually selected high-priority lines rather than all lines

Keep Runway behind an explicit provider toggle. It is available in existing envs, but it should not replace OpenAI as the default path until output quality and turnaround are compared on real prompts.

### Kling

Use for:

- optional alternate video generation
- side-by-side comparison against OpenAI and Runway on the same source prompt
- lines where stronger motion stylization matters more than strict prompt adherence

Kling credentials already exist in the inspected Railway envs, so it is a realistic fallback path. Treat it as an experimental provider until its API reliability, moderation behavior, and cost profile are measured in this app.

### Fal

Use for:

- experimental model routing when direct provider SDK support is inconvenient
- trying additional image/video models without committing them to the primary architecture
- fast evaluation spikes before deciding whether a provider deserves a first-class wrapper

Do not make Fal the core abstraction. Use it as an experimentation lane, not the default production dependency.

### Frame.io

Use for:

- review delivery after export
- sending draft cuts or selected assets into a review workflow
- attaching project/export metadata to an editorial review surface

This belongs after export, not in the critical path for research or generation. Keep the first integration minimal: push finished exports or review renders only.

## Trigger.dev Task Graph

Define tasks in a separate `trigger` area of the repo.

### First-pass tasks

- `researchLineTask`
- `researchProjectTask`
- `deepResearchLineTask`
- `extractSourceTask`
- `searchFootageTask`
- `searchYouTubeTask`
- `searchGettyTask`
- `searchInternetArchiveTask`
- `searchGoogleImagesTask`
- `searchMusicTask`
- `transcribeMediaTask`
- `generateImageTask`
- `generateVideoTask`
- `exportProjectTask`

### Task responsibilities

#### `researchLineTask`

- load `script_line`
- build a research prompt/query
- call Parallel
- persist raw result metadata
- fan out `extractSourceTask` for top candidate URLs
- synthesize final line summary with OpenAI
- if confidence is low or provenance is ambiguous, automatically trigger `deepResearchLineTask`
- update line statuses

#### `deepResearchLineTask`

- called when standard research returns low-confidence or ambiguous results
- can also be triggered manually for any line
- call Perplexity Sonar Deep Research with the line text plus context from existing Parallel results
- Perplexity autonomously searches 20+ sources, reads pages, and synthesizes
- persist results as additional `research_sources` with `provider: perplexity`
- update or replace the existing `research_summary` if Perplexity's findings are higher confidence
- update line `research_status`

#### `extractSourceTask`

- fetch source with Firecrawl
- persist extracted text to volume
- persist normalized metadata to db
- attach citation payload to `research_sources`

#### `searchFootageTask`

- query Storyblocks
- query Artlist if enabled for footage
- normalize response formats
- persist assets
- score and rank candidates
- also fan out `searchYouTubeTask`, `searchGettyTask`, `searchInternetArchiveTask`, and `searchGoogleImagesTask` in parallel

#### `searchYouTubeTask`

- build search query from line text and research context
- call YouTube Data API v3 `search.list` with relevant keywords
- follow up with `videos.list` to get full metadata (upload date, channel, view count)
- apply provenance heuristics:
  - prefer verified/official channels (news orgs, government, C-SPAN)
  - rank by upload date (earliest upload = more likely original)
  - flag re-upload and compilation channels as `is_primary_source: false`
- optionally extract transcript via `youtube-transcript-api` for top candidates
- normalize into `footage_assets` with `provider: youtube`
- persist video thumbnails to volume

#### `searchGettyTask`

- build search query from line text
- call Getty Images API with editorial filter
- normalize response into `footage_assets` with `provider: getty`
- always set `is_primary_source: true` for editorial content
- persist contributor credits and capture dates into `metadata_json`

#### `searchInternetArchiveTask`

- build search query from line text
- call Internet Archive Search API
- prefer Prelinger Archives collection for historical B-roll
- normalize response into `footage_assets` with `provider: internet_archive`
- always set `is_primary_source: true`
- persist archive metadata (collection, source, rights) into `metadata_json`

#### `searchGoogleImagesTask`

- build search query from line text
- call Google Custom Search API in image search mode
- normalize results into `footage_assets` with `provider: google_images`
- set `is_primary_source` based on source domain (`.gov`, `.edu`, wire services = true)
- results are primarily reference material — flag for AI prompt inspiration rather than direct use
- persist source page URL and image dimensions

#### `searchMusicTask`

- query Artlist for soundtrack candidates
- normalize duration, mood, BPM, license metadata

#### `transcribeMediaTask`

- send audio/video to ElevenLabs STT
- persist transcript text plus timing JSON
- optionally generate a short editorial summary with OpenAI

#### `generateImageTask`

- build image prompt from line text, research context, and desired style
- call OpenAI first
- optionally retry with Gemini if flagged or requested
- write file to volume
- persist generated asset row

#### `generateVideoTask`

- build prompt from line text plus selected still/reference
- call OpenAI video generation
- optionally route to Runway or Kling for provider-specific retries on flagged lines
- poll provider until completion
- write output to volume
- persist generated asset row

#### `exportProjectTask`

- read timeline selections
- assemble asset manifest
- run rendering pipeline
- write output file to volume
- persist export status
- optionally push the finished export into Frame.io for review

## Status Model

Use explicit per-domain statuses instead of one overloaded line status.

Recommended enums:

- `pending`
- `queued`
- `running`
- `complete`
- `failed`
- `needs_review`

For UI compatibility, compute frontend-friendly aggregate labels:

- `researched`
- `in-progress`
- `pending`
- `footage-found`

## Filesystem Strategy

Create a stable storage abstraction even though v1 uses Railway volumes.

Example helper contract:

```ts
saveFile(projectId, kind, fileName, bytes)
getAbsolutePath(projectId, kind, fileName)
getPublicDownloadRoute(projectId, kind, fileName)
```

Do not let route handlers build raw file paths inline.

Also add:

- volume health checks
- orphan cleanup task
- soft-delete logic before permanent file deletion

## Env Vars

### Core

```text
DATABASE_URL=
NODE_ENV=
APP_URL=
MEDIA_ROOT=/data/media
OPENAI_API_KEY=
GEMINI_API_KEY=
PARALLEL_API_KEY=
PERPLEXITY_API_KEY=
FIRECRAWL_API_KEY=
STORYBLOCKS_API_KEY=
ARTLIST_API_KEY=
YOUTUBE_API_KEY=
GETTY_API_KEY=
GOOGLE_CSE_API_KEY=
GOOGLE_CSE_CX=
ELEVENLABS_API_KEY=
RUNWAY_API_KEY=
RUNWAY_MODEL=
KLING_ACCESS_KEY=
KLING_SECRET_KEY=
FAL_API_KEY=
FRAMEIO_API_TOKEN=
TRIGGER_SECRET_KEY=
TRIGGER_PROJECT_REF=
```

### Optional

```text
ENABLE_ARTLIST_FOOTAGE=false
ENABLE_GEMINI_IMAGE_FALLBACK=true
ENABLE_PERPLEXITY_AUTO_ESCALATION=true
MAX_RESEARCH_SOURCES_PER_LINE=5
MAX_FOOTAGE_RESULTS_PER_PROVIDER=20
MAX_TRANSCRIPT_FILE_SIZE_MB=512
YOUTUBE_DAILY_QUOTA_LIMIT=10000
PERPLEXITY_MAX_REQUESTS_PER_DAY=50
```

## Current Secret Inventory

After inspecting the existing `Autobot`, `discord-scheduler`, and `style-lab` Railway services, these provider keys are already available somewhere in current Railway infrastructure:

- `OPENAI_API_KEY`
- `PARALLEL_API_KEY`
- `FIRECRAWL_API_KEY`
- `ELEVENLABS_API_KEY`
- `GEMINI_API_KEY`
- `YOUTUBE_API_KEY`
- `RUNWAY_API_KEY`
- `RUNWAY_MODEL`
- `KLING_ACCESS_KEY`
- `KLING_SECRET_KEY`
- `FAL_API_KEY`
- `FRAMEIO_API_TOKEN`

These planned providers were not present in the inspected envs and still need fresh secrets or account setup before implementation:

- `STORYBLOCKS_API_KEY`
- `ARTLIST_API_KEY`
- `GETTY_API_KEY`
- `PERPLEXITY_API_KEY`
- `GOOGLE_CSE_API_KEY`
- `GOOGLE_CSE_CX`

Practical implication:

- the next backend slices can immediately use `OpenAI`, `Parallel`, `Firecrawl`, `ElevenLabs`, `Gemini`, `YouTube`, `Runway`, `Kling`, `Fal`, and `Frame.io`
- stock footage/music and deep-research expansion still require new secret provisioning

## Rollout Order

### Phase 1: foundation

- create Railway project for this repo
- provision Postgres
- add Trigger.dev to repo
- add env loader and provider config validation
- add Drizzle schema and first migrations
- add base project + script APIs

### Phase 2: research

- implement `researchLineTask`
- integrate Parallel
- integrate Firecrawl extraction
- integrate OpenAI summary step
- wire research polling in the frontend

### Phase 2b: deep research

- integrate Perplexity Sonar Deep Research
- implement `deepResearchLineTask`
- add auto-escalation logic (trigger Perplexity when Parallel confidence < threshold)
- add manual "Deep Research" button in UI
- add daily request budget tracking for Perplexity (~$5/request)

### Phase 3: footage and music

- integrate Storyblocks search
- integrate Artlist music search
- evaluate Artlist footage support and enable only if API coverage is sufficient
- support selecting a candidate into `timeline_items`

### Phase 3b: expanded footage sources

- integrate YouTube Data API v3 search + metadata
- integrate youtube-transcript-api for transcript extraction from YT clips
- integrate Internet Archive API (Search + Metadata Read)
- integrate Getty Images API (editorial footage with provenance)
- integrate Google Custom Search API for reference image discovery
- add provenance ranking logic:
  - `is_primary_source` flag on all footage assets
  - rank by upload date (earliest = higher confidence)
  - prefer verified channels / known institutions
  - flag re-uploads and compilation channels
- add provider filtering in footage UI (filter by Storyblocks, YouTube, Getty, etc.)

### Phase 4: transcript ingestion

- integrate ElevenLabs STT
- add transcript job UI
- store timestamps and speaker metadata

### Phase 5: generation

- implement OpenAI image generation
- add Gemini image fallback
- implement OpenAI video generation
- persist generated assets on Railway volume

### Phase 5b: alternate generation providers

- add Gemini image runs as a first-class fallback path, not just an internal retry
- integrate Runway as an optional video fallback for selected lines
- integrate Kling as an experimental video comparison provider
- use Fal only for fast model evaluation or temporary experiments
- add provider comparison metadata so the UI can show which model produced which asset

### Phase 6: export

- define export manifest from timeline selections
- implement export task
- persist downloadable file metadata

### Phase 6b: review delivery

- push selected exports to Frame.io
- store Frame.io asset/review links against the export record
- keep review delivery optional so export completion does not depend on Frame.io uptime

## What To Implement First In This Repo

The first implementation slice should be small and vertically complete:

1. database setup
2. project + script line persistence
3. `POST /api/projects/:projectId/lines/:lineId/research`
4. Trigger task for research
5. Parallel + Firecrawl + OpenAI integration
6. polling endpoint for run status
7. frontend replacement of `sampleResearch` for one selected line

The second slice adds footage discovery across all providers:

1. `POST /api/projects/:projectId/lines/:lineId/footage-search`
2. Trigger tasks for YouTube, Internet Archive, Storyblocks, Getty, Google Images
3. provenance ranking with `is_primary_source` flag
4. frontend footage panel with provider filtering and provenance indicators
5. Perplexity deep research escalation for low-confidence lines

That gives the prototype real research + multi-source footage with provenance ranking — the core value proposition — without committing to generation or export complexity.

## Open Checks Before Coding

- confirm whether Artlist footage API access exists on your account, not just music API access
- decide whether the Trigger worker is a separate Railway service or a separate start command in the same project root
- decide whether volume files need signed download URLs or can be served through authenticated route handlers
- decide whether transcript ingestion starts from uploaded files, provider URLs, or manually pasted links
- decide whether Runway and Kling are manual fallback providers or part of the default video generation policy
- decide whether Fal should be enabled in production at all or remain an internal experimentation tool
- decide whether Frame.io is export-only or also used for intermediary review renders
- set up a Google Cloud project and enable YouTube Data API v3 + Custom Search API
- apply for Getty Images API access (requires sales contact)
- create a Perplexity API account and note the Sonar Deep Research pricing tier
- set up a Google Programmable Search Engine (PSE) configured for image search and note the CX ID

## Provenance Ranking Strategy

Not all footage sources are equal. The system should rank candidates with a provenance-aware scoring model:

### Source tier classification

| Tier | Provider | `is_primary_source` | Reasoning |
|------|----------|---------------------|-----------|
| 1 — Definitive | Internet Archive, NARA, LOC | always `true` | Preservation institutions, canonical copies |
| 2 — Wire / Editorial | Getty editorial, AP, Reuters | always `true` | Professional journalists, vetted contributors |
| 3 — Official Channels | YouTube (verified news/govt channels) | `true` | Original broadcasts from known institutions |
| 4 — Stock | Storyblocks, Artlist | `true` (original contributor) | Vetted but created-for-stock, not primary source |
| 5 — Unverified | YouTube (general), Google Images | check required | Could be original or repost |

### Ranking algorithm

For each footage candidate:

1. **Base score** from provider match relevance (keyword/semantic match)
2. **Provenance bonus** (+20 for tier 1-2, +10 for tier 3, +0 for tier 4-5)
3. **Date bonus** (earlier upload date relative to other candidates = higher score)
4. **Channel authority bonus** (verified badge, subscriber count, content consistency)
5. **Repost penalty** (-30 if title contains "reupload", "compilation", "best of", or channel is known aggregator)

The final `match_score` stored in `footage_assets` should reflect this composite score, not just keyword relevance.

## Recommendation

Implement the backend in this exact order:

1. Railway project setup
2. Postgres and migrations
3. Trigger.dev bootstrap
4. Research pipeline (Parallel + Firecrawl + OpenAI)
5. Perplexity deep research escalation
6. Storyblocks and Artlist search
7. YouTube, Internet Archive, Getty, Google Images search
8. Provenance ranking and `is_primary_source` logic
9. ElevenLabs transcripts + youtube-transcript-api
10. OpenAI image/video generation
11. Gemini image fallback + Runway/Kling evaluation path
12. Timeline persistence
13. Export pipeline
14. Frame.io review delivery

Do not start with generation or export. The product becomes usable as soon as research plus multi-provider footage search with provenance ranking work against real data.
