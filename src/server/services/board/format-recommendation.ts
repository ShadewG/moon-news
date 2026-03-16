import "server-only";

export interface BoardFormatRecommendation {
  primaryFormat: "Full Video" | "Short";
  packageLabel: string;
  supportingFormats: string[];
  confidence: number;
  urgency: "high" | "medium" | "low";
  reasons: string[];
}

interface BoardFormatRecommendationStory {
  storyType: string;
  surgeScore: number;
  controversyScore: number;
  itemsCount: number;
  sourcesCount: number;
  correction: boolean;
  lastSeenAt: string | null;
  vertical: string | null;
}

interface BoardFormatRecommendationSource {
  kind: string;
  provider: string;
  sourceType: string | null;
  sourceWeight: number;
  isPrimary: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hoursSince(value: string | null) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (Date.now() - parsed) / (1000 * 60 * 60));
}

export function buildBoardFormatRecommendation(args: {
  story: BoardFormatRecommendationStory;
  sources: BoardFormatRecommendationSource[];
  fallbackFormats?: string[];
}): BoardFormatRecommendation {
  const { story, sources } = args;
  const recentHours = hoursSince(story.lastSeenAt);
  const hasDeepEvidence = sources.some(
    (source) =>
      source.kind === "legal_watch" ||
      source.kind === "document_watch" ||
      source.sourceType === "legal" ||
      source.sourceType === "paper"
  );
  const hasVideoNativeSource = sources.some(
    (source) =>
      source.kind === "youtube_channel" ||
      source.provider === "youtube" ||
      source.sourceType === "yt"
  );
  const strongPrimary = sources.some(
    (source) => source.isPrimary && source.sourceWeight >= 90
  );
  const broadEvidence = story.sourcesCount >= 4 || story.itemsCount >= 5;
  const isFastMoving =
    story.surgeScore >= 80 || recentHours <= 18 || story.storyType === "trending";
  const isHighDepth =
    story.controversyScore >= 70 ||
    story.correction ||
    story.storyType === "controversy" ||
    hasDeepEvidence ||
    broadEvidence;

  const reasons: string[] = [];
  let primaryFormat: "Full Video" | "Short" = "Full Video";
  const supportingFormats: string[] = [];

  if (isHighDepth) {
    primaryFormat = "Full Video";
    reasons.push("enough evidence exists to support a multi-beat narrative");
  }

  if (isFastMoving) {
    if (primaryFormat === "Full Video") {
      supportingFormats.push("Short");
      reasons.push("the story is moving quickly enough to justify a same-day short");
    } else {
      primaryFormat = "Short";
      reasons.push("speed matters more than depth for the first publish");
    }
  }

  if (!isHighDepth && story.sourcesCount <= 2 && !hasDeepEvidence) {
    primaryFormat = "Short";
    reasons.push("evidence is still thin, so a shorter update is the safer first format");
  }

  if (story.correction) {
    if (!supportingFormats.includes("Short")) {
      supportingFormats.push("Short");
    }
    reasons.push("corrections usually benefit from a fast, focused follow-up");
  }

  if (hasVideoNativeSource && primaryFormat === "Full Video") {
    reasons.push("native video sources make a full package easier to illustrate");
  }

  if (strongPrimary) {
    reasons.push("at least one high-authority source is already anchored");
  }

  if (!reasons.length && args.fallbackFormats?.length) {
    reasons.push(`fallbacking to the existing editorial format package: ${args.fallbackFormats.join(" + ")}`);
  }

  const confidence = clamp(
    48 +
      (broadEvidence ? 18 : 0) +
      (hasDeepEvidence ? 12 : 0) +
      (strongPrimary ? 10 : 0) +
      (isFastMoving ? 8 : 0),
    40,
    95
  );

  const urgency: "high" | "medium" | "low" =
    story.correction || recentHours <= 12 || story.surgeScore >= 85
      ? "high"
      : recentHours <= 48 || story.controversyScore >= 65
        ? "medium"
        : "low";

  const dedupedSupportingFormats = supportingFormats.filter(
    (format, index) => supportingFormats.indexOf(format) === index && format !== primaryFormat
  );
  const packageLabel = [primaryFormat, ...dedupedSupportingFormats].join(" + ");

  return {
    primaryFormat,
    packageLabel,
    supportingFormats: dedupedSupportingFormats,
    confidence,
    urgency,
    reasons,
  };
}
