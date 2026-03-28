type BoardLiveStoryType = "normal" | "trending" | "controversy" | "competitor" | "correction";

export interface BoardLiveFeedStoryInput {
  score: number;
  controversyScore: number;
  storyType: BoardLiveStoryType;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  scoreJson?: unknown;
}

function coerceObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function coerceMetric(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const numeric = Number(value.replace(/[,_]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  return 0;
}

function getAgeHours(isoString: string | null, nowMs: number) {
  if (!isoString) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = Date.parse(isoString);
  if (!Number.isFinite(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (nowMs - timestamp) / (1000 * 60 * 60));
}

function getFreshnessMultiplier(ageHours: number) {
  if (ageHours <= 1) return 1.7;
  if (ageHours <= 3) return 1.5;
  if (ageHours <= 6) return 1.32;
  if (ageHours <= 9) return 1.16;
  if (ageHours <= 12) return 1.0;
  if (ageHours <= 18) return 0.86;
  if (ageHours <= 24) return 0.72;
  if (ageHours <= 36) return 0.58;
  if (ageHours <= 48) return 0.45;
  return 0.32;
}

function getNoveltyBonus(firstSeenAgeHours: number) {
  if (firstSeenAgeHours <= 2) return 6;
  if (firstSeenAgeHours <= 4) return 4;
  if (firstSeenAgeHours <= 8) return 2;
  return 0;
}

function getAttentionBonus(scoreJson: unknown) {
  const json = coerceObject(scoreJson);
  const aggregateViews = coerceMetric(json?.aggregateViewCount);
  const aggregateLikes = coerceMetric(json?.aggregateLikeCount);
  const aggregateReposts = coerceMetric(json?.aggregateRetweetCount);

  let bonus = 0;

  if (aggregateViews >= 1_000_000) bonus += 4;
  else if (aggregateViews >= 250_000) bonus += 3;
  else if (aggregateViews >= 50_000) bonus += 2;
  else if (aggregateViews >= 10_000) bonus += 1;

  if (aggregateLikes >= 10_000) bonus += 1;
  else if (aggregateLikes >= 1_000) bonus += 0.5;

  if (aggregateReposts >= 1_000) bonus += 1;
  else if (aggregateReposts >= 100) bonus += 0.5;

  return Math.min(6, bonus);
}

function getOutlierBonus(scoreJson: unknown) {
  const json = coerceObject(scoreJson);
  const maxXOutlierRatio = coerceMetric(json?.maxXOutlierRatio);
  const xOutlierPostCount = coerceMetric(json?.xOutlierPostCount);
  const xStrongOutlierPostCount = coerceMetric(json?.xStrongOutlierPostCount);
  const maxTikTokOutlierRatio = coerceMetric(json?.maxTikTokOutlierRatio);
  const tiktokOutlierPostCount = coerceMetric(json?.tiktokOutlierPostCount);
  const tiktokStrongOutlierPostCount = coerceMetric(json?.tiktokStrongOutlierPostCount);

  let bonus = 0;

  if (maxXOutlierRatio >= 50) bonus += 12;
  else if (maxXOutlierRatio >= 20) bonus += 10;
  else if (maxXOutlierRatio >= 10) bonus += 8;
  else if (maxXOutlierRatio >= 5) bonus += 6;
  else if (maxXOutlierRatio >= 3) bonus += 3;

  if (xStrongOutlierPostCount >= 2) bonus += 4;
  else if (xStrongOutlierPostCount >= 1) bonus += 2.5;

  if (xOutlierPostCount >= 3) bonus += 2;
  else if (xOutlierPostCount >= 2) bonus += 1;

  if (maxTikTokOutlierRatio >= 50) bonus += 12;
  else if (maxTikTokOutlierRatio >= 20) bonus += 10;
  else if (maxTikTokOutlierRatio >= 10) bonus += 8;
  else if (maxTikTokOutlierRatio >= 5) bonus += 6;
  else if (maxTikTokOutlierRatio >= 3) bonus += 3;

  if (tiktokStrongOutlierPostCount >= 2) bonus += 4;
  else if (tiktokStrongOutlierPostCount >= 1) bonus += 2.5;

  if (tiktokOutlierPostCount >= 3) bonus += 2;
  else if (tiktokOutlierPostCount >= 2) bonus += 1;

  return Math.min(16, bonus);
}

function getStoryTypeBonus(storyType: BoardLiveStoryType) {
  if (storyType === "trending") return 2;
  if (storyType === "controversy") return 1;
  return 0;
}

function getControversyBonus(controversyScore: number) {
  if (controversyScore >= 70) return 2;
  if (controversyScore >= 50) return 1.5;
  if (controversyScore >= 35) return 1;
  return 0;
}

export function computeBoardLiveFeedRank(
  story: BoardLiveFeedStoryInput,
  nowMs = Date.now()
) {
  const freshnessAgeHours = getAgeHours(story.lastSeenAt, nowMs);
  const noveltyAgeHours = getAgeHours(story.firstSeenAt, nowMs);
  const freshnessMultiplier = getFreshnessMultiplier(freshnessAgeHours);
  const noveltyBonus = getNoveltyBonus(noveltyAgeHours);
  const attentionBonus = getAttentionBonus(story.scoreJson);
  const outlierBonus = getOutlierBonus(story.scoreJson);
  const storyTypeBonus = getStoryTypeBonus(story.storyType);
  const controversyBonus = getControversyBonus(story.controversyScore);

  const rank =
    story.score * freshnessMultiplier +
    noveltyBonus +
    attentionBonus +
    outlierBonus +
    storyTypeBonus +
    controversyBonus;

  return Math.round(rank * 10) / 10;
}

export function compareBoardLiveFeedStories(
  left: BoardLiveFeedStoryInput,
  right: BoardLiveFeedStoryInput,
  nowMs = Date.now()
) {
  const liveRankDifference =
    computeBoardLiveFeedRank(right, nowMs) - computeBoardLiveFeedRank(left, nowMs);

  if (liveRankDifference !== 0) {
    return liveRankDifference;
  }

  const freshnessDifference =
    (Date.parse(right.lastSeenAt ?? "") || 0) - (Date.parse(left.lastSeenAt ?? "") || 0);

  if (freshnessDifference !== 0) {
    return freshnessDifference;
  }

  return right.score - left.score;
}
