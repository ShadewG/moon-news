# Board Score Sample

- Generated at: `2026-03-19T21:00:27.467Z`
- Sample size: `2` random stories
- Sampling window: stories with `last_seen_at` in the last `72` hours
- Scoring path: current board scorer via `scoreStory()`, including AI board assessment when available
- Model env: `gpt-4.1-mini`

## 1. NYC High School Student Freed After 10 Months in ICE Detention

- Story ID: `231eeaf8-c8f2-4f7d-947a-6a9e91f9639d`
- Final score: `33`
- Tier: `D`
- Story type: `normal`
- Status: `developing`
- Vertical: `Tech Failures`
- Sentiment score: `0.00`
- Persisted controversy score: `30`
- Sources / items: `1` / `1`
- First seen: `2026-03-18T21:04:32.000Z`
- Last seen: `2026-03-18T21:04:32.000Z`
- Last scored: `2026-03-19T21:00:29.766Z`

### Score Math

- Raw total before multipliers: `44`
- Source score: `8`
- Controversy score: `8`
- Timeliness score: `18`
- Competitor overlap: `0`
- Visual evidence: `10`
- Moon relevance: `36`
- Source base before tier-1 bonus: `3`
- Tier-1 bonus inferred: `yes`
- Board visibility score: `60`
- Relevance multiplier: `0.75 (AI visibility band)`
- Age penalty multiplier: `1.00`
- Surge active: `false`

### AI Assessment

- Model: `gpt-4.1-mini`
- Prompt version: `v1`
- Computed at: `2026-03-19T21:00:29.211Z`
- Suggested story type: `normal`
- AI board visibility: `60`
- AI moon fit: `40`
- AI controversy: `30`
- Confidence: `85`
- Explanation: The story highlights a significant humanitarian issue, but lacks strong controversy or emerging tech angle for high board visibility.

### Moon Signals

- Moon fit score: `28`
- Moon fit band: `low`
- Moon cluster: `Platform Society`
- Coverage mode: `platform_society`
- Reason codes: `cluster:Platform Society`, `coverage:platform_society`, `analog:Threads Won’t Exist In 6 Months. Here’s Why.`, `analog:South Korea Is Everything Wrong With Society`, `entity:high school student freed`, `entity:months`
- Analog titles: `Threads Won’t Exist In 6 Months. Here’s Why.`, `South Korea Is Everything Wrong With Society`, `Your City Is Hiding Secret Government Operations. Here’s Why.`, `The Debt Crisis Is Going To Destroy Society Forever`, `The Dark and Disturbing Downfall of Dubai`

### Linked Source Evidence

1. Hacker News [rss]
   Headline: NYC High School Student Freed After 10 Months in ICE Detention
   Published: 2026-03-18T21:04:32.000Z
   Ingested: 2026-03-18T21:36:16.202Z
   URL: https://www.nytimes.com/2026/03/18/nyregion/nyc-high-school-student-ice-freed.html
   Summary: Article URL: https://www.nytimes.com/2026/03/18/nyregion/nyc-high-school-student-ice-freed.html Comments URL: https://news.ycombinator.com/item?id=47431428 Points: 6 # Comments: 0

### Raw score_json

```json
{
  "tier": "D",
  "overall": 33,
  "recency": 95,
  "entityKeys": [
    "47431428",
    "article",
    "comments",
    "detention",
    "https",
    "nyc-high-school-student-ice-freed",
    "nyregion",
    "ycombinator"
  ],
  "controversy": 28,
  "moonCluster": "Platform Society",
  "moonFitBand": "low",
  "reasonCodes": [
    "cluster:Platform Society",
    "coverage:platform_society",
    "analog:Threads Won’t Exist In 6 Months. Here’s Why.",
    "analog:South Korea Is Everything Wrong With Society",
    "entity:high school student freed",
    "entity:months"
  ],
  "sourceScore": 8,
  "surgeActive": false,
  "analogTitles": [
    "Threads Won’t Exist In 6 Months. Here’s Why.",
    "South Korea Is Everything Wrong With Society",
    "Your City Is Hiding Secret Government Operations. Here’s Why.",
    "The Debt Crisis Is Going To Destroy Society Forever",
    "The Dark and Disturbing Downfall of Dubai"
  ],
  "coverageMode": "platform_society",
  "lastScoredAt": "2026-03-19T21:00:29.766Z",
  "moonFitScore": 28,
  "moonRelevance": 36,
  "lastComputedAt": "2026-03-19T20:27:49.064Z",
  "visualEvidence": 10,
  "sourceAuthority": 80,
  "timelinessScore": 18,
  "controversyScore": 8,
  "aiBoardAssessment": {
    "model": "gpt-4.1-mini",
    "inputHash": "28b26070caa14f20931611e2a528ced633e5bbb3",
    "computedAt": "2026-03-19T21:00:29.211Z",
    "confidence": 85,
    "explanation": "The story highlights a significant humanitarian issue, but lacks strong controversy or emerging tech angle for high board visibility.",
    "moonFitScore": 40,
    "promptVersion": "v1",
    "controversyScore": 30,
    "suggestedStoryType": "normal",
    "boardVisibilityScore": 60
  },
  "competitorOverlap": 0,
  "boardVisibilityScore": 60,
  "crossSourceAgreement": 0
}
```

## 2. Nvidia adds Hyundai, BYD and other automakers to self-driving tech business

- Story ID: `2ea9a751-9197-4582-ac30-ce26b6eff016`
- Final score: `20`
- Tier: `D`
- Story type: `normal`
- Status: `developing`
- Vertical: `unknown`
- Sentiment score: `0.50`
- Persisted controversy score: `30`
- Sources / items: `1` / `1`
- First seen: `2026-03-16T22:06:38.000Z`
- Last seen: `2026-03-16T22:06:38.000Z`
- Last scored: `2026-03-19T21:00:31.397Z`

### Score Math

- Raw total before multipliers: `26`
- Source score: `3`
- Controversy score: `8`
- Timeliness score: `15`
- Competitor overlap: `0`
- Visual evidence: `0`
- Moon relevance: `57`
- Source base before tier-1 bonus: `3`
- Tier-1 bonus inferred: `no`
- Board visibility score: `65`
- Relevance multiplier: `0.75 (AI visibility band)`
- Age penalty multiplier: `1.00`
- Surge active: `false`

### AI Assessment

- Model: `gpt-4.1-mini`
- Prompt version: `v1`
- Computed at: `2026-03-19T21:00:31.302Z`
- Suggested story type: `normal`
- AI board visibility: `65`
- AI moon fit: `60`
- AI controversy: `5`
- Confidence: `85`
- Explanation: Nvidia's expansion with automakers in self-driving tech is notable but not controversial or highly trending currently.

### Moon Signals

- Moon fit score: `49`
- Moon fit band: `medium`
- Moon cluster: `Institutional Failure`
- Coverage mode: `platform_society`
- Reason codes: `cluster:Institutional Failure`, `coverage:platform_society`, `analog:Why the Tesla CyberCab Failed In 5 Minutes`, `analog:Why Big Tech Is Collapsing: The Coming Big Tech Crisis`, `term:intelligence`, `term:growth`, `entity:nvidia`, `entity:hyundai`
- Analog titles: `Why the Tesla CyberCab Failed In 5 Minutes`, `Why Big Tech Is Collapsing: The Coming Big Tech Crisis`, `How ChatGPT Changed Society Forever`, `A.I Is The Biggest Lie Ever Told. Here's Why.`, `Why Men Love American Psycho`

### Linked Source Evidence

1. CNBC Tech [rss]
   Headline: Nvidia adds Hyundai, BYD and other automakers to self-driving tech business
   Published: 2026-03-16T22:06:38.000Z
   Ingested: 2026-03-16T22:07:21.601Z
   URL: https://www.cnbc.com/2026/03/16/nvidia-hyundai-byd-nissan-self-driving-tech.html
   Summary: AVs are important to Nvidia as self-driving cars remain one of the primary areas where the company can show growth outside of artificial intelligence.

### Raw score_json

```json
{
  "tier": "D",
  "overall": 20,
  "recency": 95,
  "entityKeys": [
    "artificial",
    "automakers",
    "business",
    "company",
    "important",
    "intelligence",
    "nvidia",
    "self-driving"
  ],
  "controversy": 28,
  "moonCluster": "Institutional Failure",
  "moonFitBand": "medium",
  "reasonCodes": [
    "cluster:Institutional Failure",
    "coverage:platform_society",
    "analog:Why the Tesla CyberCab Failed In 5 Minutes",
    "analog:Why Big Tech Is Collapsing: The Coming Big Tech Crisis",
    "term:intelligence",
    "term:growth",
    "entity:nvidia",
    "entity:hyundai"
  ],
  "sourceScore": 3,
  "surgeActive": false,
  "analogTitles": [
    "Why the Tesla CyberCab Failed In 5 Minutes",
    "Why Big Tech Is Collapsing: The Coming Big Tech Crisis",
    "How ChatGPT Changed Society Forever",
    "A.I Is The Biggest Lie Ever Told. Here's Why.",
    "Why Men Love American Psycho"
  ],
  "coverageMode": "platform_society",
  "lastScoredAt": "2026-03-19T21:00:31.397Z",
  "moonFitScore": 49,
  "moonRelevance": 57,
  "lastComputedAt": "2026-03-19T20:27:49.082Z",
  "visualEvidence": 0,
  "sourceAuthority": 70,
  "timelinessScore": 15,
  "controversyScore": 8,
  "aiBoardAssessment": {
    "model": "gpt-4.1-mini",
    "inputHash": "7df300d572720ffd5f59e7d00474d6d6d87c6910",
    "computedAt": "2026-03-19T21:00:31.302Z",
    "confidence": 85,
    "explanation": "Nvidia's expansion with automakers in self-driving tech is notable but not controversial or highly trending currently.",
    "moonFitScore": 60,
    "promptVersion": "v1",
    "controversyScore": 5,
    "suggestedStoryType": "normal",
    "boardVisibilityScore": 65
  },
  "competitorOverlap": 0,
  "boardVisibilityScore": 65,
  "crossSourceAgreement": 0
}
```
