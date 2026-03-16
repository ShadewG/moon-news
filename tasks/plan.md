# Moon News Studio — Full Platform Plan

## Two Core Tools

### 1. Research Board (Story Discovery)
Decide WHAT to make a video about. Live data, competitor tracking, story scoring.

### 2. Clip Library (Footage Research)
Find the FOOTAGE once you've picked a topic. Transcripts, quotes, Ask AI.

They link together: Board → "Find Footage" → opens topic search in Clip Library.

---

## TOOL 1: Research Board

### What it does
- Monitors RSS feeds, Twitter/X trends, YouTube competitor uploads, news sources
- Scores stories by virality, controversy, relevance to your channel
- Alerts on surges (breaking news, competitor uploads, trending topics)
- AI tools: Brief Me, Script Starter, Title Generator
- Production queue: track stories from discovery → research → script → film → edit → publish

### Data Sources
| Source | Method | Frequency | What it provides |
|--------|--------|-----------|-----------------|
| RSS feeds (tech, news, finance) | Direct fetch + parse | Every 15 min | Headlines, links, publish dates |
| YouTube competitor channels | YouTube RSS (no API needed) | Every 15 min | New uploads, titles, view counts |
| Twitter/X trends | xAI Grok x_search | On demand | Trending topics, viral posts |
| Google Trends | Apify or SerpAPI | Every 30 min | Search volume, trending queries |
| Reddit | Reddit RSS | Every 15 min | Hot posts from relevant subreddits |
| Hacker News | HN API (free) | Every 15 min | Top stories, comments |

### Schema (new tables)

```
feed_sources
  id, name, url, type (rss|youtube_channel|subreddit|twitter_list),
  category, polling_interval_ms, last_polled_at, status, created_at

feed_items
  id, source_id, external_id, title, url, content_snippet,
  published_at, author, fetched_at, metadata_json

stories
  id, title, vertical, status (watching|researching|scripting|filming|editing|published),
  score, controversy_score, sentiment, surge_active,
  format_suggestions, ai_brief, ai_script_draft, ai_titles_json,
  created_at, updated_at

story_feed_items (many-to-many)
  id, story_id, feed_item_id, relevance_score

story_competitors
  id, story_id, competitor_channel, video_title, video_url,
  published_at, overlap_type (same_topic|adjacent|response)

competitor_channels
  id, name, youtube_channel_id, subscriber_count, tier (1|2|3),
  last_upload_title, last_upload_date, rss_url, created_at

production_queue
  id, story_id, position, status, format, target_date,
  assigned_to, notes, created_at, updated_at
```

### Pages / Routes
- `/board` — main story board (story cards, surge banner, filters)
- `/board/queue` — production pipeline view
- `/board/competitors` — competitor channel monitoring
- `/board/sources` — all feed sources with health status
- `/board/story/:id` — story detail with AI tools

### Background Jobs (Trigger.dev)
- `poll-rss-feeds` — runs every 15 min, fetches all RSS sources
- `poll-youtube-channels` — runs every 15 min, checks competitor uploads
- `score-stories` — runs after new items ingested, clusters items into stories, calculates scores
- `detect-surges` — compares current velocity to baseline, flags surges
- `generate-brief` — on-demand AI briefing for a story
- `generate-script` — on-demand script starter draft
- `generate-titles` — on-demand title options

### Story Scoring Algorithm
```
score = (
  source_count × 8        # more sources = bigger story
  + avg_source_authority × 5  # NYT > random blog
  + controversy × 3       # abs(sentiment) × engagement
  + recency_bonus          # newer = higher
  + surge_multiplier       # 2× if velocity > 3× baseline
  + competitor_overlap × 10  # if competitors are covering it
  - staleness_penalty      # decays after peak
)
```

### Ticker Bar
Real-time scrolling alerts:
- BREAKING: new high-score story detected
- COMPETITOR: [channel] just uploaded about [topic]
- SURGE: [topic] velocity 3.7× baseline
- CORRECTION: source updated/retracted
- NOTE: channel milestone or absence

---

## TOOL 2: Clip Library (Already Built)

### What exists now
- 170 clips in library (YouTube, Twitter, Internet Archive)
- 71 transcripts cached (all YouTube clips)
- 225 verbatim quotes with verified timestamps
- Topic search across all providers
- Ask AI about any video using its transcript
- Notes system per clip
- Library browsable/searchable/filterable at `/library`
- Clip detail page at `/clips/:id` with player, quotes, transcript, notes, Ask AI

### What needs improvement (from the proposals)
- UI redesign to match the board's design system (IBM Plex Mono, Fraunces, cyan/amber/red)
- Better navigation between library and board
- Keyboard shortcuts (Cmd+K spotlight search)
- Auto-extract transcripts for new clips on ingest
- Quote extraction runs automatically, not just on search

---

## HOW THEY CONNECT

```
Research Board                          Clip Library
┌──────────────┐                       ┌──────────────┐
│ Story Cards   │──"Find Footage"──→   │ Topic Search  │
│ with scores   │                      │ across all    │
│ and sources   │                      │ providers     │
│               │                      │               │
│ AI Brief Me   │──uses quotes from──→ │ Quote Library │
│ Script Starter│                      │ 225 verified  │
│               │                      │               │
│ Competitor    │──"What clips exist"→ │ Clip Library  │
│ Tracking      │                      │ 170 clips     │
└──────────────┘                       └──────────────┘
        │                                      │
        └──────── Shared Navigation ───────────┘
              /board  ←→  /library
              /board/queue  /clips/:id
              /board/competitors  /search/:id
```

### Shared Navigation Bar
Both tools share a top-level nav:
- **Board** — story discovery (with sub-views: stories, queue, competitors, sources)
- **Library** — clip library (browse, search, filter)
- **Search** — topic search (searches everything)
- **Projects** — script-based research (existing `/reports/:id`)

---

## IMPLEMENTATION ORDER

### Phase 1: Research Board Foundation (1-2 days)
1. Schema: feed_sources, feed_items, stories, competitor_channels, production_queue
2. RSS poller: fetch and parse RSS feeds on a schedule
3. YouTube competitor poller: check channel RSS for new uploads
4. Story clustering: group related feed items into stories
5. Basic board UI at `/board` with story cards

### Phase 2: Intelligence Layer (1-2 days)
6. Story scoring algorithm
7. Surge detection (velocity vs baseline)
8. Competitor overlap detection
9. AI Brief Me / Script Starter / Title Generator
10. Ticker bar with real-time alerts

### Phase 3: Production Pipeline (1 day)
11. Production queue table + UI
12. Status workflow (watching → researching → scripting → filming → editing → published)
13. Assignment and target dates

### Phase 4: Unified Navigation (1 day)
14. Shared nav bar across board + library
15. "Find Footage" button on story cards → topic search
16. Board design system applied to clip library
17. Keyboard shortcuts (Cmd+K global search)

### Phase 5: Live Feeds (ongoing)
18. Configure initial RSS sources (tech, news, finance, crypto)
19. Configure competitor channels
20. Configure Twitter/X monitoring topics
21. Tune scoring weights based on usage

---

## INITIAL FEED SOURCES (to configure)

### RSS Feeds
**Tech/AI:** The Verge, TechCrunch, Ars Technica, Wired, MIT Tech Review, Hacker News
**Business:** Bloomberg, Reuters, WSJ, Financial Times
**Crypto:** CoinDesk, The Block, Decrypt, CryptoNews
**Investigative:** ProPublica, The Intercept, Bellingcat
**Privacy/Rights:** EFF, Proton Blog, ACLU
**Entertainment:** TMZ, Variety, Deadline Hollywood

### Competitor YouTube Channels (Tier 1)
Internet Anarchist, Patrick Cc:, Coffeezilla, ColdFusion, SunnyV2, MagnatesMedia, James Jani, Turkey Tom

### Competitor YouTube Channels (Tier 2)
LegalEagle, penguinz0, LEMMiNO, Thoughty2, SomeOrdinaryGamers

### Subreddits
r/technology, r/privacy, r/cryptocurrency, r/youtube, r/internetdrama

---

## TECH STACK (same as existing)
- Next.js 16 (App Router)
- Drizzle ORM + PostgreSQL (Railway)
- Trigger.dev for background jobs (polling, scoring)
- OpenAI gpt-4.1-mini for AI tools
- xAI Grok for Twitter/X search
- yt-dlp for YouTube transcripts
