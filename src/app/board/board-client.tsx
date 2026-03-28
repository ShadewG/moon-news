"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

import { compareBoardLiveFeedStories } from "@/lib/board-live-feed";
import type {
  BoardBootstrapPayload,
  BoardStorySummary,
  BoardStorySourcePreview,
  BoardCompetitorChannelSummary,
  ListBoardStoriesResult,
} from "@/server/services/board";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SidebarView = "board" | "queue" | "competitor" | "sources" | "briefs";
type BoardTimeWindow = "today" | "week" | "month";
type BoardWindowTab = "live_today" | "top_today" | "tiktok_fyp" | "week" | "month";
type PlatformFilter = "all" | "tiktok";
type BoardFilter =
  | "all"
  | "trending"
  | "controversy"
  | "competitor"
  | "correction"
  | "irrelevant";
type StoryStatus = "all" | "developing" | "watching" | "peaked" | "queued" | "archived";
type SortBy = "live" | "score" | "recent" | "controversy" | "sources";
type AiToolKind = "brief" | "script_starter" | "titles" | "queue" | "footage" | "research";

interface AiToolState {
  kind: AiToolKind | null;
  loading: boolean;
  content: string | null;
  items: string[];
  error: string | null;
}

function normalizeBoardStory(story: BoardStorySummary): BoardStorySummary {
  return {
    ...story,
    canonicalTitle: decodeHtml(story.canonicalTitle),
  };
}

function coerceClientObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function isStoryMarkedIrrelevant(story: Pick<BoardStorySummary, "metadataJson">) {
  const metadata = coerceClientObject(story.metadataJson);
  const editorialFeedback = coerceClientObject(metadata?.editorialFeedback);

  return (
    editorialFeedback?.irrelevant === true ||
    editorialFeedback?.relevanceLabel === "irrelevant"
  );
}

function hasPersistedStoryScore(story: Pick<BoardStorySummary, "scoreJson">) {
  const scoreJson = coerceClientObject(story.scoreJson);

  return (
    typeof scoreJson?.boardVisibilityScore === "number" &&
    typeof scoreJson?.lastScoredAt === "string" &&
    scoreJson.lastScoredAt.length > 0
  );
}

function getStoryScoreLabel(story: Pick<BoardStorySummary, "score" | "scoreJson">) {
  return hasPersistedStoryScore(story) ? String(story.score) : "…";
}

function formatCompactBoardCount(value: unknown) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[,_]/g, ""))
        : 0;

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(numeric >= 10_000_000 ? 0 : 1)}M`;
  }

  if (numeric >= 1_000) {
    return `${(numeric / 1_000).toFixed(numeric >= 100_000 ? 0 : 1)}K`;
  }

  return String(Math.round(numeric));
}

function getPositiveClientMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function getAggregatePreviewMetric(
  story: Pick<BoardStorySummary, "sourcePreviews">,
  key: "viewCount" | "likeCount" | "repostCount" | "commentCount",
) {
  return story.sourcePreviews.reduce(
    (total, source) => total + getPositiveClientMetric(source[key]),
    0,
  );
}

function getMaxPreviewMetric(
  story: Pick<BoardStorySummary, "sourcePreviews">,
  key: "commentCount" | "maxOutlierRatio",
) {
  return story.sourcePreviews.reduce(
    (max, source) => Math.max(max, getPositiveClientMetric(source[key])),
    0,
  );
}

function getTopReactionSourceScore(source: BoardStorySourcePreview) {
  const comments = getPositiveClientMetric(source.commentCount);
  const likes = getPositiveClientMetric(source.likeCount);
  const reposts = getPositiveClientMetric(source.repostCount);
  const views = getPositiveClientMetric(source.viewCount);
  const outlier = getPositiveClientMetric(source.maxOutlierRatio);

  return comments * 10 + likes + reposts * 3 + Math.round(views / 250) + outlier * 1_000;
}

function getSourceReactionSummary(source: BoardStorySourcePreview) {
  const comments = formatCompactBoardCount(source.commentCount);
  const likes = formatCompactBoardCount(source.likeCount);
  const views = formatCompactBoardCount(source.viewCount);
  const outlier =
    typeof source.maxOutlierRatio === "number" && source.maxOutlierRatio > 0
      ? `${source.maxOutlierRatio.toFixed(source.maxOutlierRatio >= 10 ? 0 : 1)}x outlier`
      : null;

  const parts = [
    comments ? `${comments} comments` : null,
    likes ? `${likes} likes` : null,
    views ? `${views} views` : null,
    outlier,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : null;
}

function getTopAudienceReactionSources(
  story: Pick<BoardStorySummary, "sourcePreviews">,
  limit = 3,
) {
  return [...story.sourcePreviews]
    .filter((source) => getTopReactionSourceScore(source) > 0)
    .sort((left, right) => getTopReactionSourceScore(right) - getTopReactionSourceScore(left))
    .slice(0, limit);
}

function getStoryAudienceReaction(
  story: Pick<BoardStorySummary, "scoreJson" | "sourcePreviews">,
) {
  const scoreJson = coerceClientObject(story.scoreJson);
  const persistedAudienceReaction = coerceClientObject(scoreJson?.audienceReaction);
  const persistedSummary =
    typeof persistedAudienceReaction?.summary === "string"
      ? persistedAudienceReaction.summary
      : null;
  const aggregateComments =
    getPositiveClientMetric(scoreJson?.aggregateCommentCount) ||
    getAggregatePreviewMetric(story, "commentCount");
  const aggregateLikes =
    getPositiveClientMetric(scoreJson?.aggregateLikeCount) ||
    getAggregatePreviewMetric(story, "likeCount");
  const aggregateViews =
    getPositiveClientMetric(scoreJson?.aggregateViewCount) ||
    getAggregatePreviewMetric(story, "viewCount");
  const maxCommentCount =
    getPositiveClientMetric(scoreJson?.maxCommentCount) ||
    getMaxPreviewMetric(story, "commentCount");
  const maxOutlierRatio = Math.max(
    getPositiveClientMetric(scoreJson?.maxXOutlierRatio),
    getPositiveClientMetric(scoreJson?.maxTikTokOutlierRatio),
    getMaxPreviewMetric(story, "maxOutlierRatio"),
  );
  const outlierCount =
    getPositiveClientMetric(scoreJson?.xOutlierPostCount) +
      getPositiveClientMetric(scoreJson?.tiktokOutlierPostCount) ||
    story.sourcePreviews.filter((source) => getPositiveClientMetric(source.maxOutlierRatio) >= 3)
      .length;
  const backlashSourceCount = getPositiveClientMetric(scoreJson?.backlashSourceCount);
  const reactionSourceCount = getPositiveClientMetric(scoreJson?.reactionSourceCount);

  let intensity =
    typeof persistedAudienceReaction?.intensity === "string"
      ? persistedAudienceReaction.intensity
      : "quiet";
  if (!persistedSummary) {
    if (
      aggregateComments >= 20_000 ||
      maxCommentCount >= 5_000 ||
      maxOutlierRatio >= 12
    ) {
      intensity = "frenzy";
    } else if (
      aggregateComments >= 5_000 ||
      maxCommentCount >= 1_000 ||
      outlierCount >= 3 ||
      aggregateLikes >= 50_000
    ) {
      intensity = "loud";
    } else if (
      aggregateComments >= 1_000 ||
      outlierCount >= 1 ||
      aggregateLikes >= 10_000 ||
      reactionSourceCount >= 2
    ) {
      intensity = "active";
    }
  }

  let mode =
    typeof persistedAudienceReaction?.mode === "string"
      ? persistedAudienceReaction.mode
      : "watching";
  if (!persistedSummary) {
    if (backlashSourceCount >= 2) {
      mode = "backlash";
    } else if (reactionSourceCount >= 2) {
      mode = "debate";
    } else if (maxOutlierRatio >= 3 || aggregateViews >= 250_000) {
      mode = "breakout";
    }
  }

  const computedSummaryParts = [
    aggregateComments > 0 ? `${formatCompactBoardCount(aggregateComments)} comments` : null,
    aggregateLikes > 0 ? `${formatCompactBoardCount(aggregateLikes)} likes` : null,
    aggregateViews > 0 ? `${formatCompactBoardCount(aggregateViews)} views` : null,
    outlierCount > 0 ? `${outlierCount} outlier posts` : null,
    backlashSourceCount >= 2
      ? "backlash-heavy"
      : reactionSourceCount >= 2
        ? "reaction-heavy"
        : null,
  ].filter(Boolean);

  return {
    intensity,
    mode,
    summary:
      persistedSummary ??
      (computedSummaryParts.length > 0
        ? `${intensity} ${mode}: ${computedSummaryParts.join(" · ")}`
        : `${intensity} ${mode}`),
    aggregateComments,
  };
}

function getStoryCommentReaction(
  story: Pick<BoardStorySummary, "metadataJson">,
) {
  const metadata = coerceClientObject(story.metadataJson);
  const reaction = coerceClientObject(metadata?.commentReaction);
  if (!reaction || reaction.status !== "ready") {
    return null;
  }

  const summary =
    typeof reaction.summary === "string" && reaction.summary.trim().length > 0
      ? reaction.summary.trim()
      : null;
  const keyThemes = Array.isArray(reaction.keyThemes)
    ? reaction.keyThemes.filter((item): item is string => typeof item === "string").slice(0, 5)
    : [];
  const standoutComments = Array.isArray(reaction.standoutComments)
    ? reaction.standoutComments
        .filter(
          (
            item,
          ): item is {
            sourceTitle: string;
            sourceUrl: string;
            author: string;
            text: string;
            likeCount?: number;
          } =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as { text?: unknown }).text === "string" &&
            typeof (item as { sourceUrl?: unknown }).sourceUrl === "string",
        )
        .slice(0, 4)
    : [];

  if (!summary && standoutComments.length === 0) {
    return null;
  }

  return {
    overallTone:
      typeof reaction.overallTone === "string" ? reaction.overallTone : "mixed",
    intensity:
      typeof reaction.intensity === "string" ? reaction.intensity : "active",
    summary,
    keyThemes,
    standoutComments,
    analyzedCommentCount: getPositiveClientMetric(reaction.analyzedCommentCount),
  };
}

function getStoryAttentionSummary(
  story: Pick<BoardStorySummary, "scoreJson" | "sourcePreviews">,
) {
  const scoreJson = coerceClientObject(story.scoreJson);
  const views = formatCompactBoardCount(scoreJson?.aggregateViewCount);
  const likes = formatCompactBoardCount(scoreJson?.aggregateLikeCount);
  const reposts = formatCompactBoardCount(scoreJson?.aggregateRetweetCount);
  const comments = formatCompactBoardCount(
    scoreJson?.aggregateCommentCount ?? getAggregatePreviewMetric(story, "commentCount"),
  );
  const parts = [
    views ? `${views} views` : null,
    likes ? `${likes} likes` : null,
    reposts ? `${reposts} reposts` : null,
    comments ? `${comments} comments` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : null;
}

function getApiBoardSort(sortBy: SortBy) {
  if (sortBy === "live") return "live";
  if (sortBy === "recent") return "recency";
  if (sortBy === "controversy") return "controversy";
  return "storyScore";
}

function getWindowTabId(
  timeWindow: BoardTimeWindow,
  sortBy: SortBy,
  platformFilter: PlatformFilter
): BoardWindowTab {
  if (platformFilter === "tiktok") {
    return "tiktok_fyp";
  }

  if (timeWindow === "today") {
    return sortBy === "score" ? "top_today" : "live_today";
  }

  return timeWindow;
}

function getWindowDisplayLabel(
  timeWindow: BoardTimeWindow,
  sortBy: SortBy,
  platformFilter: PlatformFilter
) {
  if (platformFilter === "tiktok") {
    return "tiktok fyp";
  }

  if (timeWindow === "today") {
    if (sortBy === "score") return "top today";
    if (sortBy === "live") return "live today";
    return `today · ${sortBy}`;
  }

  return timeWindow === "week" ? "top week" : "top month";
}

function isTikTokSourceKind(kind: string) {
  return kind === "tiktok_query" || kind === "tiktok_fyp_profile";
}

type TwitterWidgetsRuntime = {
  widgets?: {
    createTweet?: (
      tweetId: string,
      element: HTMLElement,
      options?: Record<string, unknown>,
    ) => Promise<HTMLElement>;
  };
};

function getPrimaryClipSource(story: Pick<BoardStorySummary, "sourcePreviews">) {
  return (
    story.sourcePreviews.find(
      (source) =>
        source.isPrimary &&
        ((source.kind === "x_account" || source.kind === "x") ||
          isTikTokSourceKind(source.kind)) &&
        source.hasVideo &&
        Boolean(source.tweetId || source.embedUrl || source.thumbnailUrl),
    ) ??
    story.sourcePreviews.find(
      (source) =>
        ((source.kind === "x_account" || source.kind === "x") ||
          isTikTokSourceKind(source.kind)) &&
        source.hasVideo &&
        Boolean(source.tweetId || source.embedUrl || source.thumbnailUrl),
    ) ??
    null
  );
}

function getHealthDotClass(status: string | null | undefined) {
  if (status === "ok") return "board-dot live";
  if (status === "warn") return "board-dot warn";
  return "board-dot";
}

function TwitterEmbed({ tweetId, url }: { tweetId: string; url: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const renderTweet = () => {
      const container = containerRef.current;
      const widgets = (window as Window & { twttr?: TwitterWidgetsRuntime }).twttr
        ?.widgets;

      if (!container || !widgets?.createTweet) {
        if (!cancelled) {
          setFailed(true);
        }
        return;
      }

      container.innerHTML = "";
      setFailed(false);
      void widgets
        .createTweet(tweetId, container, {
          align: "center",
          conversation: "none",
          dnt: true,
          theme: "dark",
        })
        .catch(() => {
          if (!cancelled) {
            setFailed(true);
          }
        });
    };
    const handleScriptError = () => {
      if (!cancelled) {
        setFailed(true);
      }
    };
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-board-twitter-widgets="true"]',
    );

    if (existingScript) {
      if (
        (window as Window & { twttr?: TwitterWidgetsRuntime }).twttr?.widgets
          ?.createTweet
      ) {
        renderTweet();
      } else {
        existingScript.addEventListener("load", renderTweet, { once: true });
        existingScript.addEventListener("error", handleScriptError, {
          once: true,
        });
      }

      return () => {
        cancelled = true;
        existingScript.removeEventListener("load", renderTweet);
        existingScript.removeEventListener("error", handleScriptError);
      };
    }

    const script = document.createElement("script");
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.setAttribute("data-board-twitter-widgets", "true");
    script.addEventListener("load", renderTweet, { once: true });
    script.addEventListener("error", handleScriptError, { once: true });
    document.body.appendChild(script);

    return () => {
      cancelled = true;
      script.removeEventListener("load", renderTweet);
      script.removeEventListener("error", handleScriptError);
    };
  }, [tweetId]);

  return (
    <div className="board-clip-embed-shell">
      <div ref={containerRef} className="board-clip-embed" />
      {failed ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="board-clip-fallback"
        >
          Open clip on X ↗
        </a>
      ) : null}
    </div>
  );
}

function TikTokClipPreview({
  url,
  thumbnailUrl,
  title,
}: {
  url: string;
  thumbnailUrl: string | null;
  title: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="board-clip-fallback"
      style={{ display: "block" }}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={title}
          style={{
            width: "100%",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.08)",
            marginBottom: 10,
            objectFit: "cover",
            maxHeight: 360,
          }}
        />
      ) : null}
      Open clip on TikTok ↗
    </a>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BoardClient({ data }: { data: BoardBootstrapPayload }) {
  const [currentView, setCurrentView] = useState<SidebarView>("board");
  const [currentTimeWindow, setCurrentTimeWindow] =
    useState<BoardTimeWindow>("today");
  const [currentFilter, setCurrentFilter] = useState<BoardFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StoryStatus>("all");
  const [sortBy, setSortBy] = useState<SortBy>(
    data.stories.query.sort === "live" ? "live" : "score",
  );
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>(
    data.stories.query.platform === "tiktok" ? "tiktok" : "all",
  );
  const [verticalFilter, setVerticalFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [stories, setStories] = useState<BoardStorySummary[]>(() =>
    data.stories.stories.map(normalizeBoardStory),
  );
  const [storiesPageInfo, setStoriesPageInfo] = useState(data.stories.pageInfo);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [queueItems, setQueueItems] = useState(data.queue);
  const [competitors, setCompetitors] = useState(data.competitors);
  const [sources, setSources] = useState(data.sources);
  const [health, setHealth] = useState(data.health);
  const [ticker, setTicker] = useState(data.ticker);
  const [selectedStory, setSelectedStory] = useState<BoardStorySummary | null>(
    null,
  );
  const [clock, setClock] = useState("");
  const [researchLoading, setResearchLoading] = useState<string | null>(null);
  const [scriptGenerating, setScriptGenerating] = useState<string | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState<string | null>(null);
  const [aiTool, setAiTool] = useState<AiToolState>({
    kind: null,
    loading: false,
    content: null,
    items: [],
    error: null,
  });
  const [briefedStories, setBriefedStories] = useState<
    Map<string, { story: BoardStorySummary; content: string }>
  >(new Map());
  // Live feed: track IDs seen in the current session for "new" badge
  const [seenStoryIds, setSeenStoryIds] = useState<Set<string>>(
    () => new Set(data.stories.stories.map((s) => s.id)),
  );
  // Pending new stories waiting for user to "reveal"
  const [pendingNewStories, setPendingNewStories] = useState<BoardStorySummary[]>([]);
  const [livePolling, setLivePolling] = useState(false);
  const [researchIndex, setResearchIndex] = useState<Record<string, { packet: boolean; writerPack: boolean; mediaScan: boolean; mediaCollector: boolean }>>({});
  const [researchPollingSlug, setResearchPollingSlug] = useState<string | null>(null);
  const researchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMountedWindowFetchRef = useRef(false);
  const livePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const commentReactionRequestsRef = useRef<Set<string>>(new Set());

  /* -- derived data -- */
  const irrelevantStories = stories.filter((story) => isStoryMarkedIrrelevant(story));
  const candidateStories = stories.filter((story) => !isStoryMarkedIrrelevant(story));
  const rssSourceCount = sources.sources.filter(
    (source) => source.kind === "rss" && source.enabled,
  ).length;
  const xSourceCount = sources.sources.filter(
    (source) => source.kind === "x_account" && source.enabled,
  ).length;
  const tiktokSourceCount = sources.sources.filter(
    (source) => isTikTokSourceKind(source.kind) && source.enabled,
  ).length;
  const liveXSourceCount = sources.sources.filter(
    (source) => source.kind === "x_account" && source.pollable,
  ).length;
  const liveTikTokSourceCount = sources.sources.filter(
    (source) => isTikTokSourceKind(source.kind) && source.pollable,
  ).length;

  const surgeStories = candidateStories.filter(
    (s) => (s.surgeScore >= 88 && s.sourcesCount >= 2) || (s.storyType === "trending" && s.surgeScore >= 85),
  );
  const topSurge =
    surgeStories.length > 0
      ? surgeStories.reduce((a, b) => (a.score > b.score ? a : b))
      : null;

  /* -- filtering + sorting -- */
  const isLiveFeed = currentTimeWindow === "today" && sortBy === "live";
  const filteredStories = stories
    .filter((s) => !briefedStories.has(s.id))
    // Live feed score floor: 30+ unless high attention
    .filter((s) => {
      if (!isLiveFeed) return true;
      const scoreJson = coerceClientObject(s.scoreJson);
      const views = typeof scoreJson?.aggregateViewCount === "number"
        ? scoreJson.aggregateViewCount as number : 0;
      const highAttention = views >= 50_000 || s.controversyScore >= 70;
      return s.score >= 30 || highAttention;
    })
    .filter((s) => {
      const markedIrrelevant = isStoryMarkedIrrelevant(s);

      if (currentFilter === "irrelevant") {
        if (!markedIrrelevant) return false;
      } else if (markedIrrelevant) {
        return false;
      }

      // Type filter
      if (currentFilter === "trending") return s.storyType === "trending" || s.surgeScore >= 75;
      if (currentFilter === "controversy") return s.storyType === "controversy" || s.controversyScore >= 70;
      if (currentFilter === "competitor") return s.storyType === "competitor";
      if (currentFilter === "correction") return s.correction;

      // Status filter
      if (statusFilter !== "all" && s.status !== statusFilter) return false;

      // Vertical filter
      if (verticalFilter !== "all" && (s.vertical ?? "") !== verticalFilter) return false;

      if (
        platformFilter === "tiktok" &&
        !s.sourcePreviews.some((source) => isTikTokSourceKind(source.kind))
      ) {
        return false;
      }

      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          s.canonicalTitle.toLowerCase().includes(q) ||
          (s.vertical ?? "").toLowerCase().includes(q) ||
          s.sourcePreviews.some((sp) => sp.name.toLowerCase().includes(q) || sp.title.toLowerCase().includes(q))
        );
      }

      return true;
    })
    .sort((a, b) => {
      if (sortBy === "live") return compareBoardLiveFeedStories(a, b);
      if (sortBy === "score") return b.score - a.score;
      if (sortBy === "controversy") return b.controversyScore - a.controversyScore;
      if (sortBy === "sources") return b.sourcesCount - a.sourcesCount;
      if (sortBy === "recent") return (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "");
      return 0;
    });

  /* -- clock -- */
  useEffect(() => {
    const update = () => {
      setClock(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const fetchResearchIndex = useCallback(async () => {
    try {
      const res = await fetch("/api/board/research-index");
      if (res.ok) {
        const json = await res.json() as Record<string, { packet: boolean; writerPack: boolean; mediaScan: boolean; mediaCollector: boolean }>;
        setResearchIndex(json);
      }
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    void fetchResearchIndex();
  }, [fetchResearchIndex]);

  useEffect(() => {
    if (!selectedStory) {
      return;
    }

    const metadata = coerceClientObject(selectedStory.metadataJson);
    if (metadata?.commentReaction) {
      return;
    }

    if (!selectedStory.sourcePreviews.some((source) => source.kind === "youtube_channel")) {
      return;
    }

    if (commentReactionRequestsRef.current.has(selectedStory.id)) {
      return;
    }

    commentReactionRequestsRef.current.add(selectedStory.id);
    let cancelled = false;

    const hydrateCommentReaction = async () => {
      try {
        const response = await fetch(
          `/api/board/stories/${selectedStory.id}/comments`,
          { method: "POST" },
        );
        if (!response.ok) {
          commentReactionRequestsRef.current.delete(selectedStory.id);
          return;
        }

        const json = await response.json() as { story?: BoardStorySummary };
        if (!json.story || cancelled) {
          commentReactionRequestsRef.current.delete(selectedStory.id);
          return;
        }

        const normalizedStory = normalizeBoardStory(json.story);
        setStories((previous) =>
          previous.map((story) =>
            story.id === normalizedStory.id ? normalizedStory : story,
          ),
        );
        setSelectedStory((current) =>
          current?.id === normalizedStory.id ? normalizedStory : current,
        );
      } catch {
        commentReactionRequestsRef.current.delete(selectedStory.id);
        // Best-effort background hydration only.
      }
    };

    void hydrateCommentReaction();

    return () => {
      cancelled = true;
    };
  }, [selectedStory]);

  useEffect(() => {
    if (currentTimeWindow !== "today") {
      return;
    }

    setStories(data.stories.stories.map(normalizeBoardStory));
    setStoriesPageInfo(data.stories.pageInfo);
  }, [currentTimeWindow, data.stories.pageInfo, data.stories.stories]);

  useEffect(() => {
    if (!hasMountedWindowFetchRef.current) {
      hasMountedWindowFetchRef.current = true;
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const normalizedSearch = searchQuery.trim();

    const loadWindowStories = async () => {
      setStoriesLoading(true);

      try {
        const params = new URLSearchParams({
          limit: "100",
          page: "1",
          timeWindow: currentTimeWindow,
          sort: getApiBoardSort(sortBy),
        });

        if (normalizedSearch) {
          params.set("search", normalizedSearch);
        }

        if (platformFilter !== "all") {
          params.set("platform", platformFilter);
        }

        if (verticalFilter !== "all") {
          params.set("vertical", verticalFilter);
        }

        const response = await fetch(`/api/board/stories?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to load stories (${response.status})`);
        }

        const result = (await response.json()) as ListBoardStoriesResult;
        if (cancelled) {
          return;
        }

        const nextStories = result.stories.map(normalizeBoardStory);
        setStories(nextStories);
        setStoriesPageInfo(result.pageInfo);
        setSelectedStory((currentStory) =>
          currentStory
            ? nextStories.find((story) => story.id === currentStory.id) ?? null
            : null,
        );
      } catch (error) {
        if (controller.signal.aborted || cancelled) {
          return;
        }

        console.error(error);
      } finally {
        if (!cancelled) {
          setStoriesLoading(false);
        }
      }
    };

    const timeoutId = setTimeout(() => {
      void loadWindowStories();
    }, normalizedSearch ? 250 : 0);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [currentTimeWindow, sortBy, searchQuery, platformFilter, verticalFilter]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const loadBoardChrome = async () => {
      try {
        const [queueRes, sourcesRes, healthRes, tickerRes] =
          await Promise.all([
            fetch("/api/board/queue", { signal: controller.signal, cache: "no-store" }),
            fetch("/api/board/sources", { signal: controller.signal, cache: "no-store" }),
            fetch("/api/board/health", { signal: controller.signal, cache: "no-store" }),
            fetch("/api/board/ticker", { signal: controller.signal, cache: "no-store" }),
          ]);

        if (cancelled) {
          return;
        }

        if (queueRes.ok) {
          const queuePayload = await queueRes.json();
          setQueueItems(
            Array.isArray(queuePayload)
              ? queuePayload
              : Array.isArray(queuePayload?.queue)
                ? queuePayload.queue
                : [],
          );
        }

        if (sourcesRes.ok) {
          setSources(await sourcesRes.json());
        }

        if (healthRes.ok) {
          setHealth(await healthRes.json());
        }

        if (tickerRes.ok) {
          const tickerPayload = await tickerRes.json();
          setTicker(
            Array.isArray(tickerPayload)
              ? tickerPayload
              : Array.isArray(tickerPayload?.ticker)
                ? tickerPayload.ticker
                : [],
          );
        }
      } catch (error) {
        if (controller.signal.aborted || cancelled) {
          return;
        }

        console.error(error);
      }
    };

    void loadBoardChrome();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (currentTimeWindow !== "today") {
      return;
    }

    if (searchQuery.trim().length > 0) {
      return;
    }

    if (!stories.some((story) => !hasPersistedStoryScore(story))) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const timeoutId = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          limit: "100",
          page: "1",
          timeWindow: "today",
          sort: getApiBoardSort(sortBy),
        });
        if (platformFilter !== "all") {
          params.set("platform", platformFilter);
        }
        if (verticalFilter !== "all") {
          params.set("vertical", verticalFilter);
        }
        const response = await fetch(`/api/board/stories?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok || cancelled) {
          return;
        }

        const result = (await response.json()) as ListBoardStoriesResult;
        if (cancelled) {
          return;
        }

        const nextStories = result.stories.map(normalizeBoardStory);
        setStories(nextStories);
        setStoriesPageInfo(result.pageInfo);
        setSelectedStory((currentStory) =>
          currentStory
            ? nextStories.find((story) => story.id === currentStory.id) ?? null
            : null,
        );
      } catch (error) {
        if (controller.signal.aborted || cancelled) {
          return;
        }

        console.error(error);
      }
    }, 5000);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [currentTimeWindow, sortBy, stories, searchQuery, platformFilter, verticalFilter]);

  /* -- cleanup typing timer -- */
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  /* -- live feed polling: auto-refresh every 45s when in today+live mode -- */
  useEffect(() => {
    if (currentTimeWindow !== "today" || sortBy !== "live" || searchQuery.trim().length > 0) {
      if (livePollingRef.current) {
        clearInterval(livePollingRef.current);
        livePollingRef.current = null;
        setLivePolling(false);
      }
      return;
    }

    setLivePolling(true);

    const poll = async () => {
      try {
        const params = new URLSearchParams({
          limit: "80",
          page: "1",
          timeWindow: "today",
          sort: "live",
        });
        if (platformFilter !== "all") {
          params.set("platform", platformFilter);
        }
        if (verticalFilter !== "all") {
          params.set("vertical", verticalFilter);
        }
        const res = await fetch(`/api/board/stories?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const result = (await res.json()) as ListBoardStoriesResult;
        const fresh = result.stories.map(normalizeBoardStory);

        setSeenStoryIds((prev) => {
          const brandNew = fresh.filter(
            (s) => !prev.has(s.id) && !briefedStories.has(s.id) && s.score >= 30,
          );
          if (brandNew.length > 0) {
            setPendingNewStories((p) => {
              const existingIds = new Set(p.map((x) => x.id));
              return [...p, ...brandNew.filter((s) => !existingIds.has(s.id))];
            });
          }
          // Update existing stories silently
          setStories((curr) => {
            const currIds = new Set(curr.map((s) => s.id));
            const updatedExisting = curr.map(
              (s) => fresh.find((f) => f.id === s.id) ?? s,
            );
            const trulyNew = brandNew.filter((s) => !currIds.has(s.id));
            return trulyNew.length > 0
              ? [...updatedExisting, ...trulyNew]
              : updatedExisting;
          });
          const next = new Set(prev);
          for (const s of fresh) next.add(s.id);
          return next;
        });
      } catch {
        // silently ignore poll errors
      }
    };

    livePollingRef.current = setInterval(() => { void poll(); }, 45_000);
    return () => {
      if (livePollingRef.current) {
        clearInterval(livePollingRef.current);
        livePollingRef.current = null;
      }
      setLivePolling(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTimeWindow, sortBy, searchQuery, platformFilter, verticalFilter]);

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                         */
  /* ---------------------------------------------------------------- */

  const handleSelectStory = useCallback((story: BoardStorySummary) => {
    setSelectedStory(story);
    setAiTool({
      kind: null,
      loading: false,
      content: null,
      items: [],
      error: null,
    });
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedStory(null);
    setAiTool({
      kind: null,
      loading: false,
      content: null,
      items: [],
      error: null,
    });
  }, []);

  const handleSwitchView = useCallback((view: SidebarView) => {
    setCurrentView(view);
  }, []);

  const handleSwitchFilter = useCallback((filter: BoardFilter) => {
    setCurrentFilter(filter);
  }, []);

  const handleSwitchTimeWindow = useCallback((tab: BoardWindowTab) => {
    if (tab === "live_today") {
      setPlatformFilter("all");
      setCurrentTimeWindow("today");
      setSortBy("live");
      return;
    }

    if (tab === "top_today") {
      setPlatformFilter("all");
      setCurrentTimeWindow("today");
      setSortBy("score");
      return;
    }

    if (tab === "tiktok_fyp") {
      setPlatformFilter("tiktok");
      setCurrentTimeWindow("today");
      setSortBy("live");
      setVerticalFilter("all");
      return;
    }

    setPlatformFilter("all");
    setCurrentTimeWindow(tab);
    setSortBy("score");
    setPendingNewStories([]);
  }, []);

  const handleRevealNewStories = useCallback(() => {
    setPendingNewStories([]);
    const feedEl = document.querySelector(".board-board-view");
    if (feedEl) feedEl.scrollTop = 0;
  }, []);

  const handleAiTool = useCallback(
    async (storyId: string, kind: AiToolKind) => {
      if (kind === "footage") {
        window.open(`/library?q=${encodeURIComponent(selectedStory?.canonicalTitle ?? "")}`, "_blank");
        return;
      }
      if (kind === "research") {
        if (selectedStory) handleTriggerResearch(selectedStory);
        return;
      }

      setAiTool({ kind, loading: true, content: null, items: [], error: null });

      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);

      try {
        const urlMap: Record<string, string> = {
          brief: `/api/board/stories/${storyId}/brief`,
          script_starter: `/api/board/stories/${storyId}/script-starter`,
          titles: `/api/board/stories/${storyId}/titles`,
          queue: `/api/board/stories/${storyId}/queue`,
        };

        const res = await fetch(urlMap[kind], { method: "POST" });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            (errBody as Record<string, string>).error ??
              `Request failed (${res.status})`,
          );
        }

        const json = await res.json();

        if (kind === "queue") {
          setAiTool({
            kind: "queue",
            loading: false,
            content: "Added to queue",
            items: [],
            error: null,
          });
          return;
        }

        const output = (
          json as { output?: { content?: string; items?: string[] } }
        ).output;
        setAiTool({
          kind,
          loading: false,
          content: output?.content ?? null,
          items: output?.items ?? [],
          error: null,
        });

        if (kind === "brief" && output?.content) {
          const briefedStory = stories.find((s) => s.id === storyId);
          if (briefedStory) {
            setBriefedStories((prev) => {
              const next = new Map(prev);
              next.set(storyId, { story: briefedStory, content: output.content! });
              return next;
            });
            setSelectedStory(null);
            setCurrentView("briefs");
          }
        }
      } catch (err) {
        setAiTool({
          kind,
          loading: false,
          content: null,
          items: [],
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [selectedStory, stories],
  );

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                          */
  /* ---------------------------------------------------------------- */

  const sourceChipClass = (kind: string) => {
    if (kind === "youtube_channel" || kind === "yt")
      return "board-source-chip board-source-yt";
    if (kind === "x_account" || kind === "x")
      return "board-source-chip board-source-x";
    if (isTikTokSourceKind(kind))
      return "board-source-chip board-source-yt";
    if (kind === "news" || kind === "rss")
      return "board-source-chip board-source-news";
    return "board-source-chip";
  };

  const sourceIcon = (kind: string) => {
    if (kind === "youtube_channel" || kind === "yt") return "\u25B6 ";
    if (kind === "x_account" || kind === "x") return "\uD835\uDD4F ";
    if (isTikTokSourceKind(kind)) return "\u266B ";
    return "";
  };

  const scoreColorClass = (score: number) => {
    if (score >= 80) return "board-score-high";
    if (score >= 65) return "board-score-med";
    return "";
  };

  const sentimentColor = (s: number) => {
    if (s < -0.5) return "board-val-red";
    if (s < 0) return "board-val-amber";
    return "board-val-green";
  };

  const controversyColor = (c: number) => {
    if (c > 75) return "board-val-red";
    if (c > 50) return "board-val-amber";
    return "";
  };

  const statusClass = (status: string) => {
    const map: Record<string, string> = {
      watching: "board-st-watching",
      researching: "board-st-researching",
      scripting: "board-st-scripting",
      filming: "board-st-filming",
      editing: "board-st-editing",
      published: "board-st-published",
      developing: "board-badge-developing",
      peaked: "board-badge-peaked",
      queued: "board-badge-developing",
      archived: "board-badge-stale",
    };
    return map[status] ?? "board-badge-developing";
  };

  const storyTypeToCardClass = (t: string) => {
    const map: Record<string, string> = {
      controversy: "board-card-controversy",
      trending: "board-card-trending",
      competitor: "board-card-competitor",
      correction: "board-card-controversy",
      normal: "board-card-normal",
    };
    return map[t] ?? "board-card-normal";
  };

  /* ---------------------------------------------------------------- */
  /*  TICKER                                                           */
  /* ---------------------------------------------------------------- */

  const renderTicker = () => {
    if (ticker.length === 0) return null;

    // Content is from our own server database (board_ticker_events table),
    // not user-generated input, so rendering as HTML is safe here.
    const doubled = [...ticker, ...ticker];
    return (
      <div className="board-ticker">
        <div className="board-ticker-inner">
          {doubled.map((t, i) => (
            <div key={`${t.id}-${i}`} className="board-tick-item">
              <span className="board-tick-label">{t.label}</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  SIDEBAR                                                          */
  /* ---------------------------------------------------------------- */

  const renderSidebar = () => {
    const navItems: {
      id: SidebarView;
      icon: string;
      label: string;
      badge?: ReactNode;
    }[] = [
      {
        id: "board",
        icon: "\u25C8",
        label: "Story Board",
        badge: (
          <span className="board-nav-badge board-badge-cyan">
            {storiesPageInfo.totalCount}
          </span>
        ),
      },
      {
        id: "queue",
        icon: "\u25B6",
        label: "Video Queue",
        badge: (
          <span className="board-nav-badge board-badge-amber">
            {queueItems.length}
          </span>
        ),
      },
      {
        id: "briefs",
        icon: "\u26A1",
        label: "Briefs",
        badge: briefedStories.size > 0 ? (
          <span className="board-nav-badge board-badge-cyan">
            {briefedStories.size}
          </span>
        ) : undefined,
      },
      {
        id: "sources",
        icon: "\u25C9",
        label: "Sources",
      },
    ];

    return (
      <nav className="board-sidebar">
        <div className="board-sidebar-logo">
          <div>
            <div className="board-moon-title">Moon NB</div>
            <div className="board-version">v3 &middot; @MoonRealYT</div>
          </div>
        </div>

        <div className="board-sidebar-section">Views</div>
        {navItems.map((item) => (
          <div
            key={item.id}
            className={`board-nav-item${currentView === item.id ? " active" : ""}`}
            onClick={() => handleSwitchView(item.id)}
          >
            <span className="board-nav-icon">{item.icon}</span>
            {item.label}
            {item.badge}
          </div>
        ))}

        <div className="board-sidebar-divider" />
        <div className="board-sidebar-section">Feed Health</div>
        <div className="board-source-row">
          <span
            className={`board-dot${health.staleSources === 0 ? " live" : " warn"}`}
          />
          Live Sources
          <span className="board-source-count">
            {health.enabledSources} configured
          </span>
        </div>
        <div className="board-source-row">
          <span className="board-dot live" />
          RSS Feeds
          <span className="board-source-count">
            {rssSourceCount} enabled
          </span>
        </div>
        <div className="board-source-row">
          <span
            className={`board-dot${liveXSourceCount > 0 ? " live" : " warn"}`}
          />
          Twitter/X
          <span className="board-source-count">
            {liveXSourceCount > 0 ? `${liveXSourceCount} live` : `${xSourceCount} configured`}
          </span>
        </div>
        {health.agentReach ? (
          <>
            <div className="board-source-row">
              <span
                className={getHealthDotClass(
                  health.agentReach.available ? "ok" : "warn",
                )}
              />
              Agent Reach
              <span className="board-source-count">
                {health.agentReach.okCount}/{health.agentReach.totalCount} ready
              </span>
            </div>
            {health.agentReach.keyChannels?.youtube ? (
              <div className="board-source-row board-text-xs board-text-muted">
                <span className={getHealthDotClass(health.agentReach.keyChannels.youtube.status)} />
                YouTube tools
                <span className="board-source-count">
                  {health.agentReach.keyChannels.youtube.status}
                </span>
              </div>
            ) : null}
            {health.agentReach.keyChannels?.twitter ? (
              <div className="board-source-row board-text-xs board-text-muted">
                <span className={getHealthDotClass(health.agentReach.keyChannels.twitter.status)} />
                X tools
                <span className="board-source-count">
                  {health.agentReach.keyChannels.twitter.status}
                </span>
              </div>
            ) : null}
            {health.agentReach.keyChannels?.reddit ? (
              <div className="board-source-row board-text-xs board-text-muted">
                <span className={getHealthDotClass(health.agentReach.keyChannels.reddit.status)} />
                Reddit tools
                <span className="board-source-count">
                  {health.agentReach.keyChannels.reddit.status}
                </span>
              </div>
            ) : null}
          </>
        ) : null}

        <div className="board-sidebar-divider" />
        <div className="board-sidebar-section">Last Polled</div>
        <div className="board-source-row board-text-xs board-text-muted">
          Latest feed{" "}
          <span className="board-text-green">
            {health.latestIngestedAt
              ? formatTimeAgo(health.latestIngestedAt)
              : "n/a"}
          </span>
        </div>

        <div className="board-sidebar-divider" />
        <div className="board-sidebar-section">Stats</div>
        <div className="board-source-row board-text-xs">
          Stories{" "}
          <span className="board-source-count board-text-cyan">
            {health.storyCount}
          </span>
        </div>
        <div className="board-source-row board-text-xs">
          Queue{" "}
          <span className="board-source-count board-text-cyan">
            {health.queueCount}
          </span>
        </div>
        <div className="board-source-row board-text-xs">
          Corrections{" "}
          <span className="board-source-count board-text-amber">
            {health.correctionCount}
          </span>
        </div>

        <div className="board-sys-note">
          Polling: 15 min intervals &middot; DB: Railway PostgreSQL
        </div>
      </nav>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  TOPBAR                                                           */
  /* ---------------------------------------------------------------- */

  const handleTriggerResearch = useCallback(async (story: BoardStorySummary) => {
    setResearchLoading(story.id);
    try {
      const res = await fetch(`/api/board/stories/${story.id}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "full" }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }

      // Clear the aiTool panel — progress is now shown in Research Outputs section
      setAiTool({ kind: null, loading: false, content: null, items: [], error: null });
      // Start polling the research index every 6s until all 4 outputs land
      setResearchPollingSlug(story.slug);
      if (researchPollRef.current) clearInterval(researchPollRef.current);
      researchPollRef.current = setInterval(async () => {
        await fetchResearchIndex();
        setResearchIndex((idx) => {
          const files = idx[story.slug];
          if (files?.packet && files?.writerPack && files?.mediaScan && files?.mediaCollector) {
            if (researchPollRef.current) clearInterval(researchPollRef.current);
            setResearchPollingSlug(null);
          }
          return idx;
        });
      }, 6000);
    } catch (error) {
      setAiTool({
        kind: "research",
        loading: false,
        content: null,
        items: [],
        error: error instanceof Error ? error.message : "Failed to start full research",
      });
    }
    setResearchLoading(null);
  }, [fetchResearchIndex]);

  const handleGenerateScript = useCallback(async (storyId: string) => {
    setScriptGenerating(storyId);
    try {
      const res = await fetch(`/api/board/stories/${storyId}/generate-script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error ?? `Failed (${res.status})`);
      }
      const data = await res.json() as { redirectUrl: string };
      window.location.href = data.redirectUrl;
    } catch (err) {
      setAiTool({
        kind: null,
        loading: false,
        content: null,
        items: [],
        error: err instanceof Error ? err.message : "Failed to generate script",
      });
    }
    setScriptGenerating(null);
  }, []);

  const updateStoryInState = useCallback((nextStory: BoardStorySummary) => {
    const normalizedStory = normalizeBoardStory(nextStory);
    setStories((currentStories) =>
      currentStories.map((story) =>
        story.id === normalizedStory.id ? normalizedStory : story,
      ),
    );
    setSelectedStory((currentStory) =>
      currentStory?.id === normalizedStory.id ? normalizedStory : currentStory,
    );
  }, []);

  const handleToggleIrrelevant = useCallback(
    async (story: BoardStorySummary) => {
      setFeedbackLoading(story.id);

      try {
        const response = await fetch(`/api/board/stories/${story.id}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            irrelevant: !isStoryMarkedIrrelevant(story),
          }),
        });

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(errorBody.error ?? `Request failed (${response.status})`);
        }

        const json = (await response.json()) as { story?: BoardStorySummary };
        if (json.story) {
          updateStoryInState(json.story);
        }
      } catch (error) {
        window.alert(
          error instanceof Error
            ? error.message
            : "Failed to update story feedback",
        );
      } finally {
        setFeedbackLoading(null);
      }
    },
    [updateStoryInState],
  );

  const renderTopbar = () => {
    const activeWindowTab = getWindowTabId(currentTimeWindow, sortBy, platformFilter);
    const windowDisplayLabel = getWindowDisplayLabel(
      currentTimeWindow,
      sortBy,
      platformFilter,
    );
    const timeWindowTabs: { id: BoardWindowTab; label: string }[] = [
      { id: "live_today", label: "live today" },
      { id: "top_today", label: "top today" },
      { id: "tiktok_fyp", label: "tiktok fyp" },
      { id: "week", label: "top week" },
      { id: "month", label: "top month" },
    ];
    const typeFilters: { id: BoardFilter; label: string }[] = [
      { id: "all", label: "all" },
      { id: "trending", label: "trending" },
      { id: "controversy", label: "controversy" },
      { id: "competitor", label: "competitor" },
      { id: "correction", label: "corrections" },
      { id: "irrelevant", label: "irrelevant" },
    ];

    const selectCls = "board-filter-select";

    return (
      <>
        {/* Stats bar — FOIA style with pipes */}
        <div className="board-stats-bar">
          <span>{filteredStories.length} shown</span>
          <span className="board-pipe">|</span>
          <span>{stories.length} loaded</span>
          <span className="board-pipe">|</span>
          <span>{storiesPageInfo.totalCount} total</span>
          <span className="board-pipe">|</span>
          <span>{windowDisplayLabel}</span>
          <span className="board-pipe">|</span>
          <span>{irrelevantStories.length} irrelevant</span>
          <span className="board-pipe">|</span>
          <span style={{ color: "var(--board-amber)" }}>{surgeStories.length} surge</span>
          <span className="board-pipe">|</span>
          <span>{health.correctionCount} corrections</span>
          <span className="board-pipe">|</span>
          <span>{health.healthySources}/{sources.sources.length} sources</span>
          <span className="board-pipe">|</span>
          <span>X {liveXSourceCount}/{xSourceCount}</span>
          <span className="board-pipe">|</span>
          <span>TikTok {liveTikTokSourceCount}/{tiktokSourceCount}</span>
          <span className="board-pipe">|</span>
          <span>{health.competitorAlerts} alerts</span>
          <span className="board-pipe">|</span>
          <span>
            {storiesLoading ? "loading..." : `${filteredStories.filter(s => {
              const ms = s.firstSeenAt ? Date.parse(s.firstSeenAt) : 0;
              return ms > 0 && (Date.now() - ms) < 2 * 60 * 60 * 1000;
            }).length} new today`}
          </span>
          <span className="board-pipe">|</span>
          {isLiveFeed && (
            <>
              <span className="board-live-indicator">
                <span className="board-live-dot" />
                LIVE
              </span>
              {livePolling && <span style={{ color: "var(--board-muted)", fontSize: 9 }}>↺ polling</span>}
              <span className="board-pipe">|</span>
            </>
          )}
          <span className="board-topbar-clock">{clock}</span>
        </div>

        {/* View tabs */}
        <div className="board-topbar">
          <div className="board-view-tabs">
            {timeWindowTabs.map((tab) => (
              <div
                key={tab.id}
                className={`board-vtab${activeWindowTab === tab.id ? " active" : ""}`}
                onClick={() => handleSwitchTimeWindow(tab.id)}
              >
                {tab.label}
              </div>
            ))}
          </div>
          <span className="board-pipe">|</span>
          <div className="board-view-tabs">
            {typeFilters.map((f) => (
              <div
                key={f.id}
                className={`board-vtab${currentFilter === f.id ? " active" : ""}`}
                onClick={() => handleSwitchFilter(f.id)}
              >
                {f.label}
              </div>
            ))}
          </div>
          <span className="board-pipe">|</span>

          {/* Status filter */}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StoryStatus)} className={selectCls}>
            <option value="all">status: all</option>
            <option value="developing">developing</option>
            <option value="watching">watching</option>
            <option value="peaked">peaked</option>
            <option value="queued">queued</option>
            <option value="archived">archived</option>
          </select>

          {/* Vertical filter */}
          <select value={verticalFilter} onChange={(e) => setVerticalFilter(e.target.value)} className={selectCls}>
            <option value="all">vertical: all</option>
            <option value="TikTok / FYP">tiktok / fyp</option>
            <option value="Celebrity / Hollywood">celebrity</option>
            <option value="Podcast Reactions">podcasts</option>
            <option value="Tech Failures">tech failures</option>
            <option value="AI & Automation">AI</option>
            <option value="Big Tech / Billionaires">billionaires</option>
            <option value="Digital Rights / Piracy">digital rights</option>
            <option value="Scams & Fraud">scams</option>
            <option value="Social Issues / Culture">social issues</option>
            <option value="Internet Drama">internet drama</option>
            <option value="Government / Corruption">government</option>
            <option value="Uncategorized">uncategorized</option>
          </select>

          {/* Sort */}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className={selectCls}>
            {currentTimeWindow === "today" && <option value="live">sort: live</option>}
            <option value="score">sort: score</option>
            <option value="recent">sort: recent</option>
            <option value="controversy">sort: controversy</option>
            <option value="sources">sort: sources</option>
          </select>

          <div className="board-topbar-spacer" />

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="search stories..."
            className="board-search-input"
          />
        </div>
      </>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  SURGE BANNER                                                     */
  /* ---------------------------------------------------------------- */

  const renderSurgeBanner = () => {
    if (!topSurge) return null;

    return (
      <div className="board-surge-banner">
        <span className="board-surge-bolt">{"\u26A1"}</span>
        <div className="board-surge-text">
          <div className="board-surge-title">
            BREAKING &mdash; {topSurge.canonicalTitle}
          </div>
          <div className="board-surge-sub">
            {topSurge.sourcesCount} sources &middot; Controversy Score{" "}
            {topSurge.controversyScore} &middot;{" "}
            {topSurge.storyType === "trending"
              ? "Trending"
              : "Story developing fast"}
          </div>
        </div>
        <div>
          <div className="board-surge-score-num">
            {topSurge.controversyScore}
          </div>
          <div className="board-surge-label">controversy</div>
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  STORY CARD                                                       */
  /* ---------------------------------------------------------------- */

  const renderStoryCard = (story: BoardStorySummary, index: number) => {
    const isActive = selectedStory?.id === story.id;
    const markedIrrelevant = isStoryMarkedIrrelevant(story);
    const sentPct = Math.abs(story.sentimentScore) * 100;
    const sentDir = story.sentimentScore < 0 ? "neg" : "pos";
    const contPct = story.controversyScore;
    const attentionSummary = getStoryAttentionSummary(story);
    // A story is "fresh" if it was first seen in the last 2 hours
    const firstSeenMs = story.firstSeenAt ? Date.parse(story.firstSeenAt) : 0;
    const isJustIn = firstSeenMs > 0 && (Date.now() - firstSeenMs) < 2 * 60 * 60 * 1000;

    return (
      <div
        key={story.id}
        className={`board-story-card ${storyTypeToCardClass(story.storyType)}${isActive ? " active" : ""}${isJustIn && isLiveFeed ? " board-card-new" : ""}`}
        style={{ animationDelay: `${Math.min(index, 5) * 0.05}s` }}
        onClick={() => handleSelectStory(story)}
      >
        {/* Header */}
        <div className="board-card-header">
          <div
            className={`board-card-score ${hasPersistedStoryScore(story) ? scoreColorClass(story.score) : "board-score-pending"}`}
          >
            {getStoryScoreLabel(story)}
          </div>
          <div className="board-card-title-block">
            <div className="board-card-title">
              {isJustIn && isLiveFeed && (
                <span className="board-new-badge">NEW</span>
              )}
              {story.canonicalTitle}
            </div>
            <div className="board-card-meta">
              {story.vertical && (
                <span>
                  {"\u25C8"} {story.vertical}
                </span>
              )}
              <span>
                {"\u229E"} {story.itemsCount} items
              </span>
              <span>
                {"\u23F1"} {story.ageLabel}
              </span>
              {attentionSummary && (
                <span>
                  {"\u25CE"} {attentionSummary}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Badges */}
        <div className="board-card-badges">
          <span className={`board-badge-pill ${statusClass(story.status)}`}>
            {story.status}
          </span>
          {story.surgeScore >= 88 && story.sourcesCount >= 2 && (
            <span className="board-badge-pill board-badge-surge">
              {"\u26A1"} SURGE {story.sourcesCount} sources
            </span>
          )}
          {story.correction && (
            <span className="board-badge-pill board-badge-correction">
              {"\u26A0"} CORRECTION
            </span>
          )}
          {markedIrrelevant && (
            <span className="board-badge-pill board-badge-irrelevant">
              IRRELEVANT
            </span>
          )}
          {story.formats.map((f) => (
            <span key={f} className="board-badge-pill board-badge-format">
              {f}
            </span>
          ))}
        </div>

        {/* Summary snippet from primary source */}
        {story.sourcePreviews[0]?.summary && (
          <div className="board-card-summary">
            {decodeHtml(story.sourcePreviews[0].summary.slice(0, 150))}
            {story.sourcePreviews[0].summary.length > 150 ? "..." : ""}
          </div>
        )}

        {/* Source chips — clickable to open source */}
        <div className="board-card-sources">
          {story.sourcePreviews.slice(0, 4).map((src) => (
            <a
              key={src.id}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className={sourceChipClass(src.kind)}
              onClick={(e) => e.stopPropagation()}
              title={decodeHtml(src.title)}
              style={{ textDecoration: "none", cursor: "pointer" }}
            >
              {sourceIcon(src.kind)}
              {src.name} ↗
            </a>
          ))}
          {story.sourcesCount > 4 && (
            <span className="board-source-chip">
              +{story.sourcesCount - 4} more
            </span>
          )}
        </div>

        {/* Sentiment & controversy */}
        <div className="board-card-sentiment">
          <span>Sentiment {story.sentimentScore.toFixed(2)}</span>
          <div className="board-sentiment-bar">
            <div
              className={`board-sentiment-fill ${sentDir}`}
              style={{ width: `${sentPct}%` }}
            />
          </div>
          <div className="board-controversy-meter">
            Controversy
            <div className="board-c-bar">
              <div
                className="board-c-fill"
                style={{ width: `${contPct}%` }}
              />
            </div>
            <span
              className={
                contPct > 75
                  ? "board-text-red"
                  : contPct > 50
                    ? "board-text-amber"
                    : "board-text-muted2"
              }
            >
              {contPct}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="board-card-actions">
          <button
            className="board-btn board-btn-brief"
            onClick={(e) => {
              e.stopPropagation();
              handleSelectStory(story);
              setTimeout(() => handleAiTool(story.id, "brief"), 50);
            }}
          >
            {"\u26A1"} Brief Me
          </button>
          <button
            className="board-btn board-btn-script"
            onClick={(e) => {
              e.stopPropagation();
              handleSelectStory(story);
              setTimeout(() => handleAiTool(story.id, "script_starter"), 50);
            }}
          >
            {"\u270D"} Script Starter
          </button>
          <button
            className={`board-btn ${markedIrrelevant ? "board-btn-restore" : "board-btn-ignore"}`}
            onClick={(e) => {
              e.stopPropagation();
              void handleToggleIrrelevant(story);
            }}
            disabled={feedbackLoading === story.id}
          >
            {feedbackLoading === story.id
              ? "\u2026"
              : markedIrrelevant
                ? "\u21BA Unmark"
                : "\u2298 Irrelevant"}
          </button>
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  RIGHT PANEL                                                      */
  /* ---------------------------------------------------------------- */

  const renderAiOutput = () => {
    if (!aiTool.kind) return null;

    if (aiTool.loading) {
      return (
        <div className="board-panel-section">
          <div className="board-panel-section-title">
            {aiTool.kind === "brief" && "\u26A1 Brief Me"}
            {aiTool.kind === "script_starter" && "\u270D Script Starter"}
            {aiTool.kind === "titles" && "\u25C8 Title Generator"}
            {aiTool.kind === "queue" && "\u25B6 Adding to Queue"}
            {aiTool.kind === "research" && "\uD83D\uDD0D Full Research"}
          </div>
          <div className="board-brief-output">
            <span className="board-ai-typing" />
          </div>
        </div>
      );
    }

    if (aiTool.error) {
      return (
        <div className="board-panel-section">
          <div className="board-panel-section-title board-text-red">Error</div>
          <div className="board-brief-output">
            <p style={{ color: "var(--board-red)" }}>{aiTool.error}</p>
          </div>
        </div>
      );
    }

    if (aiTool.kind === "queue") {
      return (
        <div className="board-panel-section">
          <div className="board-queue-success">
            <div className="board-queue-success-icon">{"\u2713"}</div>
            <div className="board-queue-success-title">
              {selectedStory?.canonicalTitle}
            </div>
            <div className="board-queue-success-meta">
              Added to Video Queue
              <br />
              Status: Watching
            </div>
          </div>
        </div>
      );
    }

    if (aiTool.kind === "titles" && aiTool.items.length > 0) {
      return (
        <div className="board-panel-section">
          <div className="board-panel-section-title">
            {"\u25C8"} Title Generator
          </div>
          <div className="board-text-meta" style={{ marginBottom: 10 }}>
            {aiTool.items.length} Title Options &mdash; CTR optimised
          </div>
          <div className="board-titles-list">
            {aiTool.items.map((title, i) => (
              <div key={i} className="board-title-option">
                <span className="board-title-num">{i + 1}.</span>
                {title}
              </div>
            ))}
          </div>
        </div>
      );
    }

    // AI brief/script content comes from our own server-side AI output
    // (board_story_ai_outputs table), not from user input.
    if (aiTool.content) {
      return (
        <div className="board-panel-section">
          <div className="board-panel-section-title">
            {aiTool.kind === "brief" && "\u26A1 Brief Me"}
            {aiTool.kind === "script_starter" && "\u270D Script Starter"}
            {aiTool.kind === "titles" && "\u25C8 Title Generator"}
            {aiTool.kind === "research" && "\uD83D\uDD0D Full Research"}
          </div>
          <div
            className={
              aiTool.kind === "script_starter"
                ? "board-script-draft"
                : "board-brief-output"
            }
          >
            <AiContentRenderer html={aiTool.content} />
          </div>
        </div>
      );
    }

    return null;
  };

  const renderPanelContent = () => {
    if (!selectedStory) {
      return (
        <div className="board-panel-empty">
          <div className="board-panel-empty-icon">{"\u25C8"}</div>
          <div className="board-panel-empty-text">
            Click any story card to
            <br />
            see details and AI tools
          </div>
        </div>
      );
    }

    const s = selectedStory;
    const markedIrrelevant = isStoryMarkedIrrelevant(s);
    const clipSource = getPrimaryClipSource(s);
    const audienceReaction = getStoryAudienceReaction(s);
    const commentReaction = getStoryCommentReaction(s);
    const topReactionSources = getTopAudienceReactionSources(s);

    const researchFiles = researchIndex[s.slug];

    return (
      <>
        {/* AI output — shown first so it's immediately visible */}
        {renderAiOutput()}

        {/* Research Outputs */}
        {(() => {
          const isPolling = researchPollingSlug === s.slug;
          const outputs = [
            { key: "writerPack" as const, label: "Writer Pack", desc: "angle + script framework", href: `/research/writer-packets/${s.slug}/` },
            { key: "packet" as const, label: "Research Packet", desc: "sources, facts, quotes", href: `/research/packets/${s.slug}` },
            { key: "mediaScan" as const, label: "Media Scan", desc: "clip & footage mapping", href: `/research/media-mission-scan/${s.slug}` },
            { key: "mediaCollector" as const, label: "Media Collector", desc: "asset inventory", href: `/research/media-collector/${s.slug}` },
          ];
          const readyCount = outputs.filter(o => researchFiles?.[o.key]).length;
          const allReady = readyCount === outputs.length;
          const anyReady = readyCount > 0;
          return (
            <div className="board-panel-section">
              <div className="board-panel-section-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                Research Outputs
                {isPolling && (
                  <span style={{ color: "#555", fontSize: "9px", fontWeight: 400, animation: "board-pulse 1.4s ease-in-out infinite" }}>
                    generating…
                  </span>
                )}
                {allReady && !isPolling && (
                  <span style={{ color: "#5b9", fontSize: "9px", fontWeight: 400 }}>✓ complete</span>
                )}
                {anyReady && !allReady && !isPolling && (
                  <span style={{ color: "#888", fontSize: "9px", fontWeight: 400 }}>{readyCount}/{outputs.length}</span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {outputs.map(({ key, label, desc, href }) => {
                  const ready = researchFiles?.[key] === true;
                  const pending = isPolling && !ready;
                  return ready ? (
                    <a
                      key={key}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        background: "#0a1a12",
                        border: "1px solid #1a3a2a",
                        borderRadius: "4px",
                        textDecoration: "none",
                        color: "#5b9",
                        fontSize: "11px",
                        transition: "all 0.12s",
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "#0f2a1a"; (e.currentTarget as HTMLAnchorElement).style.borderColor = "#2a5a3a"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "#0a1a12"; (e.currentTarget as HTMLAnchorElement).style.borderColor = "#1a3a2a"; }}
                    >
                      <span style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        <span style={{ color: "#3a6e5a", fontSize: "10px" }}>{desc}</span>
                      </span>
                      <span style={{ fontSize: "10px", opacity: 0.6 }}>↗</span>
                    </a>
                  ) : (
                    <div
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        background: "#0a0a0a",
                        border: "1px solid #1a1a1a",
                        borderRadius: "4px",
                        color: "#333",
                        fontSize: "11px",
                        opacity: pending ? 1 : 0.6,
                      }}
                    >
                      <span style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                        <span>{label}</span>
                        <span style={{ color: "#2a2a2a", fontSize: "10px" }}>{desc}</span>
                      </span>
                      {pending && (
                        <span style={{ fontSize: "9px", color: "#444", animation: "board-pulse 1.4s ease-in-out infinite" }}>···</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Story metrics */}
        <div className="board-panel-section">
          <div className="board-panel-section-title">Story Metrics</div>
          <div className="board-detail-row">
            <span className="board-detail-key">Moon Score</span>
            <span
              className={`board-detail-val ${hasPersistedStoryScore(s) ? scoreColorClass(s.score) === "board-score-high" ? "board-val-cyan" : scoreColorClass(s.score) === "board-score-med" ? "board-val-amber" : "" : ""}`}
            >
              {getStoryScoreLabel(s)}
            </span>
          </div>
          <div className="board-detail-row">
            <span className="board-detail-key">Status</span>
            <span className="board-detail-val">{s.status}</span>
          </div>
          <div className="board-detail-row">
            <span className="board-detail-key">Sentiment</span>
            <span
              className={`board-detail-val ${sentimentColor(s.sentimentScore)}`}
            >
              {s.sentimentScore.toFixed(2)}
            </span>
          </div>
          <div className="board-detail-row">
            <span className="board-detail-key">Controversy Score</span>
            <span
              className={`board-detail-val ${controversyColor(s.controversyScore)}`}
            >
              {s.controversyScore}
            </span>
          </div>
          <div className="board-detail-row">
            <span className="board-detail-key">Format Suggestion</span>
            <span className="board-detail-val">{s.formats.join(", ")}</span>
          </div>
          <div className="board-detail-row">
            <span className="board-detail-key">Age</span>
            <span className="board-detail-val">{s.ageLabel}</span>
          </div>
          <div className="board-detail-row">
            <span className="board-detail-key">Items</span>
            <span className="board-detail-val">{s.itemsCount}</span>
          </div>
          <div className="board-detail-row">
            <span className="board-detail-key">Sources</span>
            <span className="board-detail-val">{s.sourcesCount}</span>
          </div>
          <div className="board-detail-row">
            <span className="board-detail-key">Editorial Label</span>
            <span className="board-detail-val">
              {markedIrrelevant ? "irrelevant" : "candidate"}
            </span>
          </div>
        </div>

        <div className="board-panel-section">
          <div className="board-panel-section-title">Audience Reaction</div>
          <div className="board-detail-row">
            <span className="board-detail-key">Reaction Level</span>
            <span
              className={`board-detail-val ${
                audienceReaction.intensity === "frenzy"
                  ? "board-val-cyan"
                  : audienceReaction.intensity === "loud"
                    ? "board-val-amber"
                    : ""
              }`}
            >
              {audienceReaction.intensity} {audienceReaction.mode}
            </span>
          </div>
          <div
            style={{
              color: "var(--board-text)",
              fontSize: "11px",
              lineHeight: 1.55,
              marginTop: "8px",
            }}
          >
            {audienceReaction.summary}
          </div>
          {topReactionSources.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
              {topReactionSources.map((source) => {
                const reactionSummary = getSourceReactionSummary(source);
                return (
                  <a
                    key={`${source.id}-${source.feedItemId}`}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="board-source-list-item"
                    style={{ display: "block", textDecoration: "none", color: "inherit" }}
                  >
                    <div className="board-src-name">
                      {sourceIcon(source.kind)}
                      {source.name}
                      <span style={{ marginLeft: "auto", color: "var(--board-muted)", fontSize: "9px" }}>↗</span>
                    </div>
                    <div className="board-src-meta">{decodeHtml(source.title)}</div>
                    {reactionSummary ? (
                      <div className="board-src-summary">{reactionSummary}</div>
                    ) : null}
                  </a>
                );
              })}
            </div>
          ) : null}
        </div>

        {commentReaction ? (
          <div className="board-panel-section">
            <div className="board-panel-section-title">Comment Signals</div>
            <div
              style={{
                color: "var(--board-text)",
                fontSize: "11px",
                lineHeight: 1.55,
              }}
            >
              {commentReaction.summary}
            </div>
            {commentReaction.keyThemes.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  marginTop: "10px",
                }}
              >
                {commentReaction.keyThemes.map((theme) => (
                  <span key={theme} className="board-source-chip">
                    {theme}
                  </span>
                ))}
              </div>
            ) : null}
            {commentReaction.standoutComments.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                {commentReaction.standoutComments.map((comment, index) => (
                  <a
                    key={`${comment.sourceUrl}-${index}`}
                    href={comment.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="board-source-list-item"
                    style={{ display: "block", textDecoration: "none", color: "inherit" }}
                  >
                    <div className="board-src-name">
                      {comment.author}
                      <span style={{ marginLeft: "auto", color: "var(--board-muted)", fontSize: "9px" }}>
                        {formatCompactBoardCount(comment.likeCount) ? `${formatCompactBoardCount(comment.likeCount)} likes` : "↗"}
                      </span>
                    </div>
                    <div className="board-src-meta">{comment.sourceTitle}</div>
                    <div className="board-src-summary">
                      “{decodeHtml(comment.text)}”
                    </div>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="board-panel-section">
          <div className="board-panel-section-title">Editorial Feedback</div>
          <button
            className={`board-btn board-btn-wide ${markedIrrelevant ? "board-btn-restore" : "board-btn-ignore"}`}
            onClick={() => void handleToggleIrrelevant(s)}
            disabled={feedbackLoading === s.id}
          >
            {feedbackLoading === s.id
              ? "saving..."
              : markedIrrelevant
                ? "\u21BA Unmark as irrelevant"
                : "\u2298 Mark as irrelevant for prompt testing"}
          </button>
        </div>

        {clipSource ? (
          <div className="board-panel-section">
            <div className="board-panel-section-title">Clip</div>
            <div className="board-clip-card">
              <div className="board-clip-meta">
                <span className={sourceChipClass(clipSource.kind)}>
                  {sourceIcon(clipSource.kind)}
                  {clipSource.name}
                </span>
                {clipSource.publishedAt ? (
                  <span className="board-clip-time">
                    {formatTimeAgo(clipSource.publishedAt)}
                  </span>
                ) : null}
              </div>
              {clipSource.videoDescription ? (
                <div className="board-clip-description">
                  {decodeHtml(clipSource.videoDescription)}
                </div>
              ) : null}
              {clipSource.tweetId ? (
                <TwitterEmbed
                  tweetId={clipSource.tweetId}
                  url={clipSource.embedUrl ?? clipSource.url}
                />
              ) : isTikTokSourceKind(clipSource.kind) ? (
                <TikTokClipPreview
                  url={clipSource.embedUrl ?? clipSource.url}
                  thumbnailUrl={clipSource.thumbnailUrl}
                  title={clipSource.title}
                />
              ) : (
                <a
                  href={clipSource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="board-clip-fallback"
                >
                  Open clip ↗
                </a>
              )}
            </div>
          </div>
        ) : null}

        {/* Sources list */}
        <div className="board-panel-section">
          <div className="board-panel-section-title">
            Sources ({s.sourcePreviews.length})
          </div>
          {s.sourcePreviews.map((src) => (
            (() => {
              const reactionSummary = getSourceReactionSummary(src);
              return (
                <a
                  key={src.id}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="board-source-list-item"
                  style={{ display: "block", textDecoration: "none", color: "inherit" }}
                >
                  <div className="board-src-name">
                    {sourceIcon(src.kind)}
                    {src.name}
                    {src.hasVideo ? (
                      <span className="board-src-pill">clip</span>
                    ) : null}
                    <span style={{ marginLeft: "auto", color: "var(--board-muted)", fontSize: "9px" }}>↗</span>
                  </div>
                  <div className="board-src-meta">
                    {decodeHtml(src.title)}
                    {src.publishedAt
                      ? ` \u00B7 ${formatTimeAgo(src.publishedAt)}`
                      : ""}
                  </div>
                  {reactionSummary ? (
                    <div className="board-src-summary" style={{ color: "var(--board-muted2)" }}>
                      {reactionSummary}
                    </div>
                  ) : null}
                  {src.summary && (
                    <div className="board-src-summary">
                      {decodeHtml(src.summary.slice(0, 200))}
                      {src.summary.length > 200 ? "..." : ""}
                    </div>
                  )}
                </a>
              );
            })()
          ))}
        </div>

        {/* AI tools buttons */}
        <div className="board-panel-section">
          <div className="board-panel-section-title">AI Tools</div>
          <div className="board-panel-tools">
            <button
              className="board-btn board-btn-brief board-btn-wide"
              onClick={() => handleAiTool(s.id, "brief")}
            >
              {"\u26A1"} Brief Me &mdash; 3-paragraph briefing
            </button>
            <button
              className="board-btn board-btn-script board-btn-wide"
              onClick={() => handleGenerateScript(s.id)}
              disabled={scriptGenerating === s.id}
            >
              {scriptGenerating === s.id ? "launching..." : "\u270D Script Agent \u2014 full script pipeline"}
            </button>
            <button
              className="board-btn board-btn-wide"
              style={{ background: "var(--board-blue-dim)", color: "var(--board-blue)" }}
              onClick={() => handleAiTool(s.id, "research")}
              disabled={researchLoading === s.id}
            >
              {researchLoading === s.id ? "running..." : "\uD83D\uDD0D Run Full Research"}
            </button>
          </div>
        </div>

      </>
    );
  };

  const renderRightPanel = () => (
    <div className="board-right-panel">
      <div className="board-panel-header">
        <span className="board-panel-title">
          {selectedStory
            ? selectedStory.vertical ?? "Story Detail"
            : "Select a story"}
        </span>
        <span className="board-panel-close" onClick={handleClosePanel}>
          {"\u2715"}
        </span>
      </div>
      <div className="board-panel-body">{renderPanelContent()}</div>
    </div>
  );

  /* ---------------------------------------------------------------- */
  /*  BRIEFS VIEW                                                      */
  /* ---------------------------------------------------------------- */

  const renderBriefsView = () => {
    const todayBriefs = Array.from(briefedStories.values());

    if (todayBriefs.length === 0) {
      return (
        <div className="board-content-area">
          <div className="board-board-view">
            <div className="board-panel-empty" style={{ marginTop: 60 }}>
              <div className="board-panel-empty-icon">⚡</div>
              <div className="board-panel-empty-text">
                No briefs yet — click &ldquo;Brief Me&rdquo; on any story
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="board-content-area">
        {/* Brief list */}
        <div className="board-board-view">
          <div className="board-briefs-header">
            <span style={{ color: "var(--board-cyan)" }}>⚡</span>
            Today&apos;s Briefs
            <span className="board-briefs-count">{todayBriefs.length}</span>
          </div>

          {todayBriefs.map(({ story, content }) => {
            const isActive = selectedStory?.id === story.id;
            const attentionSummary = getStoryAttentionSummary(story);
            return (
              <div
                key={story.id}
                className={`board-brief-card${isActive ? " active" : ""}`}
                onClick={() => handleSelectStory(story)}
              >
                {/* Score + title */}
                <div className="board-card-header">
                  <div className={`board-card-score ${scoreColorClass(story.score)}`}>
                    {story.score}
                  </div>
                  <div className="board-card-title-block">
                    <div className="board-card-title">{story.canonicalTitle}</div>
                    <div className="board-card-meta">
                      {story.vertical && <span>◈ {story.vertical}</span>}
                      <span>⊞ {story.itemsCount} items</span>
                      <span>⏱ {story.ageLabel}</span>
                      {attentionSummary && <span>◎ {attentionSummary}</span>}
                    </div>
                  </div>
                </div>

                {/* Brief text preview */}
                <div className="board-brief-preview">
                  <AiContentRenderer html={content} />
                </div>

                {/* Source chips */}
                <div className="board-card-sources" style={{ marginTop: 8 }}>
                  {story.sourcePreviews.slice(0, 4).map((src) => (
                    <a
                      key={src.id}
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={sourceChipClass(src.kind)}
                      onClick={(e) => e.stopPropagation()}
                      title={decodeHtml(src.title)}
                      style={{ textDecoration: "none" }}
                    >
                      {sourceIcon(src.kind)}{src.name} ↗
                    </a>
                  ))}
                  {story.sourcesCount > 4 && (
                    <span className="board-source-chip">+{story.sourcesCount - 4} more</span>
                  )}
                </div>

                {/* Actions */}
                <div className="board-card-actions" style={{ marginTop: 8 }}>
                  <button
                    className="board-btn board-btn-script"
                    onClick={(e) => { e.stopPropagation(); void handleGenerateScript(story.id); }}
                    disabled={scriptGenerating === story.id}
                  >
                    {scriptGenerating === story.id ? "launching..." : "✍ Script Agent"}
                  </button>
                  <button
                    className="board-btn"
                    style={{ background: "var(--board-blue-dim)", color: "var(--board-blue)" }}
                    onClick={(e) => { e.stopPropagation(); void handleTriggerResearch(story); }}
                    disabled={researchLoading === story.id}
                  >
                    {researchLoading === story.id ? "running..." : "🔍 Deep Research"}
                  </button>
                  <button
                    className="board-btn board-btn-ignore"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBriefedStories((prev) => {
                        const next = new Map(prev);
                        next.delete(story.id);
                        return next;
                      });
                      if (selectedStory?.id === story.id) setSelectedStory(null);
                    }}
                  >
                    ✕ Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right panel — story detail when a brief is selected */}
        {renderRightPanel()}
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  BOARD VIEW                                                       */
  /* ---------------------------------------------------------------- */

  const renderBoardView = () => (
    <div className="board-content-area">
      <div className="board-board-view">
        {/* Live feed "new stories" reveal banner */}
        {isLiveFeed && pendingNewStories.length > 0 && (
          <button
            className="board-new-stories-banner"
            onClick={handleRevealNewStories}
          >
            <span className="board-new-dot" />
            <span>
              ↑ {pendingNewStories.length} new {pendingNewStories.length === 1 ? "story" : "stories"} — click to refresh
            </span>
          </button>
        )}
        {renderSurgeBanner()}
        {filteredStories.map((story, i) => renderStoryCard(story, i))}
        {filteredStories.length === 0 && (
          <div className="board-panel-empty">
            <div className="board-panel-empty-icon">{"\u25C8"}</div>
            <div className="board-panel-empty-text">
              No stories match this filter
            </div>
          </div>
        )}
      </div>
      {renderRightPanel()}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /*  QUEUE VIEW                                                       */
  /* ---------------------------------------------------------------- */

  const renderQueueView = () => {
    const stages = [
      "watching",
      "researching",
      "scripting",
      "filming",
      "editing",
      "published",
    ] as const;

    const stageColors: Record<string, string> = {
      watching: "var(--board-muted)",
      researching: "var(--board-blue)",
      scripting: "var(--board-amber)",
      filming: "var(--board-purple)",
      editing: "var(--board-cyan)",
      published: "var(--board-green)",
    };

    const counts: Record<string, number> = {};
    for (const s of stages) {
      counts[s] = queueItems.filter((q) => q.status === s).length;
    }

    return (
      <div className="board-queue-view">
        <div className="board-queue-view-inner">
          <div className="board-view-header">Video Queue</div>
          <div className="board-view-sub">
            Production pipeline &middot; {queueItems.length} items total
          </div>

          <div className="board-pipeline-stages">
            {stages.map((s) => (
              <div key={s} className="board-stage">
                <div
                  className="board-stage-name"
                  style={{ color: stageColors[s] }}
                >
                  {s}
                </div>
                <div
                  className="board-stage-count"
                  style={{ color: stageColors[s] }}
                >
                  {counts[s]}
                </div>
              </div>
            ))}
          </div>

          <table className="board-queue-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Story</th>
                <th>Score</th>
                <th>Status</th>
                <th>Format</th>
                <th>Target</th>
                <th>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {queueItems.map((q) => (
                <tr key={q.id}>
                  <td className="board-queue-pos">{q.position}</td>
                  <td>
                    <div className="board-queue-row-title">{q.storyTitle}</div>
                    {q.notes && (
                      <div className="board-queue-row-meta">{q.notes}</div>
                    )}
                  </td>
                  <td>
                    <span
                      className="board-score-num"
                      style={{
                        color:
                          (q.score ?? 0) >= 80
                            ? "var(--board-cyan)"
                            : (q.score ?? 0) >= 65
                              ? "var(--board-amber)"
                              : "var(--board-muted2)",
                      }}
                    >
                      {q.score ?? "\u2014"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`board-status-pill ${statusClass(q.status)}`}
                    >
                      {q.status}
                    </span>
                  </td>
                  <td className="board-queue-format">{q.format ?? "\u2014"}</td>
                  <td className="board-queue-target">
                    {q.targetPublishAt
                      ? new Date(q.targetPublishAt).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" },
                        )
                      : "TBD"}
                  </td>
                  <td
                    className="board-queue-assigned"
                    style={{
                      color:
                        q.assignedTo && q.assignedTo !== "\u2014"
                          ? "var(--board-cyan)"
                          : "var(--board-muted)",
                    }}
                  >
                    {q.assignedTo ?? "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  COMPETITORS VIEW                                                 */
  /* ---------------------------------------------------------------- */

  const renderCompetitorCard = (ch: BoardCompetitorChannelSummary) => (
    <div key={ch.id} className="board-comp-card">
      <div className="board-comp-card-top">
        <div className="board-comp-name">{ch.name}</div>
        {ch.alertLevel === "hot" && (
          <span className="board-comp-alert">
            {"\u26A1"} SAME TOPIC
          </span>
        )}
        {ch.alertLevel === "watch" && (
          <span
            className="board-comp-alert"
            style={{
              background: "var(--board-amber-dim)",
              color: "var(--board-amber)",
            }}
          >
            WATCH
          </span>
        )}
      </div>
      <div className="board-comp-subs">
        {ch.subscribersLabel ?? "\u2014"} &middot;{" "}
        {ch.handle ?? ch.platform}
      </div>
      {ch.latestTitle && (
        <div className="board-comp-latest">{ch.latestTitle}</div>
      )}
      <div className="board-comp-time">
        Latest upload &middot; {ch.latestTimeLabel}
      </div>
    </div>
  );

  const renderCompetitorsView = () => (
    <div className="board-competitor-view">
      <div className="board-competitor-view-inner">
        <div className="board-view-header">Competitor Activity</div>
        <div className="board-view-sub">
          {competitors.stats.totalChannels} channels polled every 15 minutes
          via native YouTube RSS
        </div>

        <div
          className="board-tier-label"
          style={{ color: "var(--board-red)" }}
        >
          TIER 1 &mdash; Direct Competitors
        </div>
        <div className="board-comp-grid">
          {competitors.tiers.tier1.map(renderCompetitorCard)}
        </div>

        <div
          className="board-tier-label"
          style={{ color: "var(--board-amber)" }}
        >
          TIER 2 &mdash; Adjacent / Overlapping
        </div>
        <div className="board-comp-grid">
          {competitors.tiers.tier2.map(renderCompetitorCard)}
        </div>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- */
  /*  SOURCES VIEW                                                     */
  /* ---------------------------------------------------------------- */

  const renderSourcesView = () => (
    <div className="board-sources-view">
      <div className="board-sources-view-inner">
        <div className="board-view-header">All Sources</div>
        <div className="board-view-sub">
          {sources.sources.length} sources &middot; RSS polled every 15 minutes
          &middot; Content hashed on every fetch
        </div>

        <div className="board-sources-grid">
          {sources.categories.map((cat) => (
            <div key={cat.name} className="board-src-cat-card">
              <div
                className="board-src-cat-title"
                style={{ color: cat.color }}
              >
                {cat.name}
              </div>
              {cat.items.map((item) => (
                <div key={item} className="board-src-cat-item">
                  <span className="board-live-dot" />
                  {item}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- */
  /*  MAIN RENDER                                                      */
  /* ---------------------------------------------------------------- */

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />

      <style>{boardStyles}</style>

      <div className="board-root">
        {renderTicker()}
        <div className="board-shell">
          {renderSidebar()}
          <div className="board-main">
            {renderTopbar()}
            {currentView === "board" && renderBoardView()}
            {currentView === "queue" && renderQueueView()}
            {currentView === "briefs" && renderBriefsView()}
            {currentView === "sources" && renderSourcesView()}
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  AiContentRenderer — renders trusted server HTML safely             */
/* ------------------------------------------------------------------ */

/**
 * Renders HTML content from our own server-side AI output tables.
 * This content is generated by our AI pipeline and stored in the
 * board_story_ai_outputs database table — it is not user-generated.
 */
function AiContentRenderer({ html }: { html: string }) {
  // eslint-disable-next-line react/no-danger
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ------------------------------------------------------------------ */
/*  Utility                                                            */
/* ------------------------------------------------------------------ */

function decodeHtml(text: string): string {
  return text
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#8212;/g, "\u2014")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "n/a";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(1, Math.floor(diffMs / (1000 * 60)));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  const diffMo = Math.floor(diffD / 30);
  return `${diffMo}mo ago`;
}

/* ------------------------------------------------------------------ */
/*  Embedded CSS — matches reference design system exactly             */
/* ------------------------------------------------------------------ */

const boardStyles = `
/* ── CSS VARIABLES — CIA Terminal Aesthetic ── */
.board-root {
  --board-bg:        #080808;
  --board-bg1:       #0a0a0a;
  --board-bg2:       #0c0c0c;
  --board-bg3:       #111111;
  --board-bg4:       #181818;
  --board-border:    #181818;
  --board-border2:   #222222;
  --board-cyan:      #5b9;
  --board-cyan-dim:  #1a2a1e;
  --board-amber:     #c93;
  --board-amber-dim: #2a1a0a;
  --board-red:       #a44;
  --board-red-dim:   #2a0f0f;
  --board-green:     #4a4;
  --board-green-dim: #0a1a0a;
  --board-purple:    #86a;
  --board-purple-dim:#1a0f2a;
  --board-blue:      #68a;
  --board-blue-dim:  #0f1a2a;
  --board-muted:     #444;
  --board-muted2:    #666;
  --board-text:      #999;
  --board-text-bright:#ccc;
  --board-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --board-serif: 'IBM Plex Mono', ui-monospace, monospace;
}

.board-root,
.board-root * {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.board-root {
  height: calc(100vh - 32px);
  width: 100vw;
  background: var(--board-bg);
  color: var(--board-text);
  font-family: var(--board-mono);
  font-size: 11px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  z-index: 50;
}

/* ── UTILITY CLASSES ── */
.board-text-xs    { font-size: 10px; }
.board-text-muted { color: var(--board-muted); }
.board-text-muted2{ color: var(--board-muted2); }
.board-text-cyan  { color: var(--board-cyan); }
.board-text-amber { color: var(--board-amber); }
.board-text-red   { color: var(--board-red); }
.board-text-green { color: var(--board-green); }
.board-text-meta  { font-size: 10px; color: var(--board-muted); }

/* ── SURGE TICKER ── */
.board-ticker {
  height: 32px;
  background: linear-gradient(90deg, #1a0a00, #2d1600, #1a0a00);
  border-bottom: 1px solid var(--board-amber);
  display: flex;
  align-items: center;
  overflow: hidden;
  position: relative;
  flex-shrink: 0;
}
.board-ticker::before {
  content: '\\26A1 SURGE ALERTS';
  font-size: 10px;
  font-weight: 600;
  color: var(--board-amber);
  padding: 0 16px;
  white-space: nowrap;
  z-index: 2;
  background: linear-gradient(90deg, #2d1600, #2d1600);
  border-right: 1px solid var(--board-amber);
  display: flex;
  align-items: center;
  height: 100%;
}
.board-ticker-inner {
  display: flex;
  gap: 0;
  animation: board-ticker-scroll 40s linear infinite;
  white-space: nowrap;
}
.board-ticker-inner:hover {
  animation-play-state: paused;
}
@keyframes board-ticker-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
.board-tick-item {
  padding: 0 32px;
  font-size: 11px;
  color: var(--board-text);
  display: flex;
  align-items: center;
  gap: 8px;
  border-right: 1px solid #2a1a00;
}
.board-tick-label {
  color: #000;
  background: var(--board-amber);
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 2px;
  white-space: nowrap;
}

/* ── SHELL ── */
.board-shell {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ── LEFT SIDEBAR ── */
.board-sidebar {
  width: 220px;
  min-width: 220px;
  background: var(--board-bg1);
  border-right: 1px solid var(--board-border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.board-sidebar-logo {
  padding: 16px 14px 12px;
  border-bottom: 1px solid var(--board-border);
  display: flex;
  align-items: center;
  gap: 8px;
}
.board-moon-title {
  font-family: var(--board-mono);
  font-size: 18px;
  font-weight: 700;
  color: var(--board-text-bright);
  letter-spacing: -0.5px;
}
.board-version {
  font-size: 9px;
  color: var(--board-muted);
  margin-top: 2px;
}
.board-sidebar-section {
  padding: 10px 14px 4px;
  font-size: 9px;
  font-weight: 600;
  color: var(--board-muted);
  text-transform: uppercase;
  letter-spacing: 1.5px;
}
.board-nav-item {
  padding: 7px 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--board-muted2);
  font-size: 12px;
  transition: all 0.15s;
  border-left: 2px solid transparent;
  position: relative;
}
.board-nav-item:hover {
  background: var(--board-bg2);
  color: var(--board-text-bright);
}
.board-nav-item.active {
  background: var(--board-bg2);
  color: var(--board-cyan);
  border-left-color: var(--board-cyan);
}
.board-nav-icon {
  font-size: 13px;
  width: 16px;
  text-align: center;
}
.board-nav-badge {
  margin-left: auto;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 2px;
}
.board-sidebar-divider {
  height: 1px;
  background: var(--board-border);
  margin: 8px 14px;
}

/* Source health rows */
.board-source-row {
  padding: 5px 14px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--board-muted2);
}
.board-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.board-dot.live {
  background: var(--board-green);
  box-shadow: 0 0 6px var(--board-green);
}
.board-dot.warn {
  background: var(--board-amber);
}
.board-source-count {
  margin-left: auto;
  font-size: 10px;
  color: var(--board-muted);
}
.board-sys-note {
  font-size: 9px;
  color: var(--board-muted);
  padding: 4px 14px;
  border-top: 1px solid var(--board-border);
  flex-shrink: 0;
  margin-top: auto;
}

/* ── MAIN AREA ── */
.board-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── TOPBAR ── */
/* Stats bar — FOIA style */
.board-stats-bar {
  height: 24px;
  background: var(--board-bg2);
  border-bottom: 1px solid var(--board-border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 0;
  flex-shrink: 0;
  font-size: 10px;
  color: var(--board-muted);
}
.board-pipe {
  color: var(--board-border2);
  padding: 0 8px;
}

/* Filter bar */
.board-topbar {
  height: 28px;
  background: var(--board-bg1);
  border-bottom: 1px solid var(--board-border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 6px;
  flex-shrink: 0;
}
.board-filter-select {
  background: var(--board-bg);
  border: 1px solid var(--board-border);
  color: var(--board-muted2);
  font-family: var(--board-mono);
  font-size: 10px;
  padding: 1px 4px;
  height: 20px;
  outline: none;
  cursor: pointer;
}
.board-filter-select:focus {
  border-color: var(--board-border2);
}
.board-search-input {
  background: var(--board-bg);
  border: 1px solid var(--board-border);
  color: var(--board-text);
  font-family: var(--board-mono);
  font-size: 10px;
  padding: 2px 8px;
  height: 20px;
  width: 180px;
  outline: none;
}
.board-search-input:focus {
  border-color: var(--board-border2);
}
.board-search-input::placeholder {
  color: var(--board-muted);
}
.board-view-tabs {
  display: flex;
  gap: 2px;
}
.board-vtab {
  padding: 5px 14px;
  font-size: 11px;
  font-family: var(--board-mono);
  font-weight: 500;
  color: var(--board-muted2);
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.15s;
}
.board-vtab:hover {
  background: var(--board-bg3);
  color: var(--board-text);
}
.board-vtab.active {
  background: var(--board-bg3);
  color: var(--board-cyan);
}
.board-topbar-spacer { flex: 1; }
.board-topbar-stat {
  font-size: 11px;
  color: var(--board-muted);
  display: flex;
  align-items: center;
  gap: 5px;
}
.board-topbar-val { color: var(--board-text); }
.board-topbar-clock {
  font-size: 11px;
  color: var(--board-cyan);
  font-weight: 600;
  padding: 4px 10px;
  background: var(--board-cyan-dim);
  border-radius: 3px;
}

/* ── CONTENT AREA ── */
.board-content-area {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ── BOARD VIEW (story list) ── */
.board-board-view {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  align-content: start;
}
.board-board-view::-webkit-scrollbar       { width: 5px; }
.board-board-view::-webkit-scrollbar-thumb { background: var(--board-border2); border-radius: 3px; }

/* ── SURGE BANNER ── */
.board-surge-banner {
  background: linear-gradient(135deg, var(--board-amber-dim), #1a1000);
  border: 1px solid var(--board-amber);
  border-radius: 3px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  animation: board-pulse-border 2s ease-in-out infinite;
}
@keyframes board-pulse-border {
  0%, 100% { border-color: var(--board-amber); }
  50%      { border-color: #7a4e00; }
}
.board-surge-bolt      { font-size: 18px; }
.board-surge-text      { flex: 1; }
.board-surge-title     { font-size: 12px; font-weight: 600; color: var(--board-amber); }
.board-surge-sub       { font-size: 11px; color: var(--board-muted2); margin-top: 2px; }
.board-surge-score-num {
  font-family: var(--board-mono);
  font-size: 28px;
  font-weight: 700;
  color: var(--board-amber);
}
.board-surge-label {
  font-size: 9px;
  color: var(--board-muted);
  margin-top: -4px;
  text-align: center;
}

/* ── STORY CARD ── */
.board-story-card {
  background: var(--board-bg2);
  border: 1px solid var(--board-border);
  border-radius: 3px;
  padding: 10px 14px;
  cursor: pointer;
  transition: all 0.18s;
  position: relative;
  overflow: visible;
  animation: board-fadeInUp 0.3s ease both;
}
.board-story-card:hover {
  border-color: var(--board-border2);
  background: var(--board-bg3);
  transform: translateY(-1px);
}
.board-story-card.active {
  border-color: var(--board-cyan);
  background: var(--board-bg3);
  box-shadow: inset 0 0 0 1px var(--board-cyan), 0 0 12px rgba(91,187,153,0.08);
}
.board-story-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
}
.board-card-controversy::before { background: var(--board-red); }
.board-card-trending::before    { background: var(--board-amber); }
.board-card-competitor::before  { background: var(--board-purple); }
.board-card-normal::before      { background: var(--board-border2); }

/* ── BRIEFS VIEW ── */
.board-briefs-header {
  font-size: 11px;
  font-weight: 700;
  color: var(--board-muted2);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 2px 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.board-briefs-count {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 2px;
  background: var(--board-cyan-dim);
  color: var(--board-cyan);
}
.board-brief-card {
  background: var(--board-bg2);
  border: 1px solid var(--board-border);
  border-left: 3px solid var(--board-cyan);
  border-radius: 3px;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.18s;
  animation: board-fadeInUp 0.3s ease both;
}
.board-brief-card:hover {
  border-color: var(--board-border2);
  border-left-color: var(--board-cyan);
  background: var(--board-bg3);
}
.board-brief-card.active {
  border-color: var(--board-cyan);
  background: var(--board-bg3);
  box-shadow: inset 0 0 0 1px var(--board-cyan), 0 0 12px rgba(91,187,153,0.06);
}
.board-brief-preview {
  font-size: 11px;
  color: var(--board-text);
  line-height: 1.55;
  margin: 8px 0 4px;
  border-left: 2px solid var(--board-border2);
  padding-left: 10px;
  /* clamp to ~3 lines */
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.board-brief-preview p { margin: 0; }
.board-brief-preview ul { margin: 4px 0; padding-left: 16px; }
.board-brief-preview li { margin-bottom: 2px; }

@keyframes board-fadeInUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── LIVE FEED NEW CARD ── */
.board-card-new {
  animation: board-slideInFresh 0.45s cubic-bezier(0.22,1,0.36,1) both !important;
  border-color: rgba(91,187,153,0.35) !important;
}
@keyframes board-slideInFresh {
  from { opacity: 0; transform: translateY(-12px) scale(0.98); border-color: rgba(91,187,153,0.7); box-shadow: 0 0 20px rgba(91,187,153,0.15); }
  60%  { border-color: rgba(91,187,153,0.5); }
  to   { opacity: 1; transform: translateY(0) scale(1); border-color: rgba(91,187,153,0.35); box-shadow: none; }
}

/* NEW badge on card title */
.board-new-badge {
  display: inline-block;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #0a0a0a;
  background: var(--board-cyan);
  padding: 2px 5px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: middle;
  animation: board-badge-pulse 2s ease-in-out 3;
}
@keyframes board-badge-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.55; }
}

/* ── NEW STORIES BANNER ── */
.board-new-stories-banner {
  width: 100%;
  padding: 8px 14px;
  background: linear-gradient(90deg, rgba(91,187,153,0.12), rgba(91,187,153,0.06));
  border: 1px solid rgba(91,187,153,0.3);
  border-radius: 4px;
  color: var(--board-cyan);
  font-family: var(--board-mono);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.15s, border-color 0.15s;
  animation: board-fadeInUp 0.25s ease both;
  letter-spacing: 0.04em;
  text-align: left;
}
.board-new-stories-banner:hover {
  background: linear-gradient(90deg, rgba(91,187,153,0.2), rgba(91,187,153,0.1));
  border-color: rgba(91,187,153,0.5);
}
.board-new-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--board-cyan);
  flex-shrink: 0;
  animation: board-live-pulse 1s ease-in-out infinite;
}

/* ── LIVE INDICATOR ── */
.board-live-indicator {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--board-cyan);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
}
.board-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--board-cyan);
  box-shadow: 0 0 6px var(--board-cyan);
  animation: board-live-pulse 1.4s ease-in-out infinite;
}
@keyframes board-live-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.75); }
}

/* Card header */
.board-card-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}
.board-card-score {
  font-family: var(--board-mono);
  font-size: 22px;
  font-weight: 700;
  color: var(--board-text-bright);
  line-height: 1;
  min-width: 32px;
  text-align: center;
}
.board-score-pending { color: var(--board-muted2) !important; }
.board-score-high { color: var(--board-cyan) !important; }
.board-score-med  { color: var(--board-amber) !important; }
.board-card-title-block { flex: 1; }
.board-card-title {
  font-family: var(--board-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--board-text-bright);
  line-height: 1.4;
  margin-bottom: 4px;
}
.board-card-meta {
  font-size: 10px;
  color: var(--board-muted);
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.board-card-meta span {
  display: flex;
  align-items: center;
  gap: 3px;
}
.board-card-summary {
  font-size: 11px;
  color: var(--board-text);
  line-height: 1.4;
  margin: 4px 0 2px;
  opacity: 0.75;
}

/* Badges */
.board-card-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 6px;
  margin-top: 6px;
}
.board-badge-pill {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}
.board-badge-developing  { background: var(--board-cyan-dim);  color: var(--board-cyan); }
.board-badge-peaked      { background: var(--board-amber-dim); color: var(--board-amber); }
.board-badge-stale       { background: var(--board-bg4);       color: var(--board-muted); }
.board-badge-surge       { background: var(--board-amber-dim); color: var(--board-amber); }
.board-badge-correction  { background: var(--board-red-dim);   color: var(--board-red); }
.board-badge-irrelevant  { background: #231717;                color: #d58c8c; }
.board-badge-format {
  background: var(--board-bg4);
  color: var(--board-muted2);
  border: 1px solid var(--board-border2);
}

/* Nav badges */
.board-badge-red   { background: var(--board-red-dim);   color: var(--board-red); }
.board-badge-amber { background: var(--board-amber-dim); color: var(--board-amber); }
.board-badge-cyan  { background: var(--board-cyan-dim);  color: var(--board-cyan); }

/* Source chips */
.board-card-sources {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.board-source-chip {
  font-size: 9px;
  padding: 2px 7px;
  background: var(--board-bg4);
  border: 1px solid var(--board-border2);
  border-radius: 2px;
  color: var(--board-muted2);
}
.board-source-yt   { border-color: #ff000044; color: #ff6666; }
.board-source-x    { border-color: #ffffff22; color: #aaa; }
.board-source-news { border-color: #3b82f622; color: #6b9cf5; }

/* Sentiment & controversy */
.board-card-sentiment {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10px;
  color: var(--board-muted);
}
.board-sentiment-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--board-bg4);
  width: 80px;
  position: relative;
  overflow: hidden;
}
.board-sentiment-fill {
  height: 100%;
  border-radius: 2px;
  position: absolute;
  left: 50%;
}
.board-sentiment-fill.neg {
  background: var(--board-red);
  transform-origin: right;
  right: 50%;
  left: auto;
}
.board-sentiment-fill.pos {
  background: var(--board-green);
  transform-origin: left;
}
.board-controversy-meter {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
}
.board-c-bar {
  height: 5px;
  border-radius: 3px;
  background: var(--board-bg4);
  width: 60px;
  overflow: hidden;
}
.board-c-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--board-amber), var(--board-red));
}

/* Card actions */
.board-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--board-border);
}

/* ── BUTTONS ── */
.board-btn {
  font-family: var(--board-mono);
  font-size: 10px;
  font-weight: 600;
  padding: 5px 11px;
  border-radius: 3px;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.board-btn-brief   { background: var(--board-cyan-dim);   color: var(--board-cyan); }
.board-btn-brief:hover   { background: #006677; }
.board-btn-queue   { background: var(--board-purple-dim); color: var(--board-purple); }
.board-btn-queue:hover   { background: #3d2a7a; }
.board-btn-script  { background: var(--board-amber-dim);  color: var(--board-amber); }
.board-btn-script:hover  { background: #4a3000; }
.board-btn-title   { background: var(--board-green-dim);  color: var(--board-green); }
.board-btn-title:hover   { background: #103d28; }
.board-btn-footage { background: var(--board-blue-dim);   color: var(--board-blue); }
.board-btn-footage:hover { background: #1e3d7a; }
.board-btn-ignore  { background: #231717; color: #d58c8c; }
.board-btn-ignore:hover  { background: #3a2020; }
.board-btn-restore { background: #1f2618; color: #a8cc8a; }
.board-btn-restore:hover { background: #2d3821; }
.board-btn-wide {
  text-align: left;
  padding: 9px 12px;
  width: 100%;
}

/* ── RIGHT PANEL ── */
.board-right-panel {
  width: 380px;
  min-width: 380px;
  background: var(--board-bg1);
  border-left: 1px solid var(--board-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.board-panel-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--board-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.board-panel-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--board-text-bright);
  text-transform: uppercase;
  letter-spacing: 1px;
}
.board-panel-close {
  font-size: 14px;
  color: var(--board-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
}
.board-panel-close:hover {
  background: var(--board-bg2);
  color: var(--board-text);
}
.board-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.board-panel-body::-webkit-scrollbar       { width: 4px; }
.board-panel-body::-webkit-scrollbar-thumb { background: var(--board-border2); }

/* Panel empty state */
.board-panel-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--board-muted);
}
.board-panel-empty-icon { font-size: 28px; margin-bottom: 10px; }
.board-panel-empty-text { font-size: 12px; }

/* Panel sections */
.board-panel-section      { margin-bottom: 16px; }
.board-panel-section-title {
  font-size: 9px;
  font-weight: 700;
  color: var(--board-muted);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  margin-bottom: 8px;
}
.board-detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid var(--board-border);
  font-size: 11px;
}
.board-detail-key { color: var(--board-muted); }
.board-detail-val { color: var(--board-text-bright); font-weight: 600; }
.board-val-cyan   { color: var(--board-cyan)  !important; }
.board-val-red    { color: var(--board-red)   !important; }
.board-val-amber  { color: var(--board-amber) !important; }
.board-val-green  { color: var(--board-green) !important; }

/* Source list items */
.board-source-list-item {
  padding: 6px 0;
  border-bottom: 1px solid var(--board-border);
  font-size: 11px;
}
.board-src-name { color: var(--board-text-bright); margin-bottom: 2px; }
.board-src-meta { color: var(--board-muted); font-size: 10px; }
.board-src-summary { color: var(--board-text); font-size: 10px; opacity: 0.7; margin-top: 3px; line-height: 1.3; }

/* Panel AI tools */
.board-panel-tools {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

/* Brief output */
.board-brief-output {
  background: var(--board-bg2);
  border: 1px solid var(--board-border);
  border-radius: 2px;
  padding: 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--board-text);
}
.board-brief-output h4 {
  font-family: var(--board-mono);
  font-size: 14px;
  color: var(--board-cyan);
  margin-bottom: 8px;
  font-weight: 600;
}
.board-brief-output p { margin-bottom: 10px; }
.board-brief-output .angle {
  background: var(--board-bg3);
  border-left: 2px solid var(--board-amber);
  padding: 8px 12px;
  border-radius: 0 4px 4px 0;
  color: var(--board-text-bright);
  font-size: 11px;
  margin-top: 8px;
}
.board-brief-output .angle-label {
  font-size: 9px;
  color: var(--board-amber);
  font-weight: 700;
  margin-bottom: 4px;
}

/* Script draft */
.board-script-draft {
  background: var(--board-bg2);
  border: 1px solid var(--board-border);
  border-radius: 2px;
  padding: 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--board-text);
  font-family: var(--board-mono);
}
.board-script-draft .label {
  font-family: var(--board-mono);
  font-size: 9px;
  color: var(--board-amber);
  font-weight: 700;
  margin-bottom: 8px;
}

/* Titles list */
.board-titles-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.board-title-option {
  background: var(--board-bg2);
  border: 1px solid var(--board-border);
  border-radius: 2px;
  padding: 9px 11px;
  font-family: var(--board-mono);
  font-size: 13px;
  color: var(--board-text-bright);
  cursor: pointer;
  transition: all 0.15s;
}
.board-title-option:hover {
  border-color: var(--board-cyan);
  color: var(--board-cyan);
}
.board-title-num {
  color: var(--board-muted);
  font-family: var(--board-mono);
  font-size: 10px;
  margin-right: 8px;
}

/* AI typing cursor */
.board-ai-typing {
  display: inline-block;
  width: 8px;
  height: 14px;
  background: var(--board-cyan);
  animation: board-blink 0.8s step-end infinite;
  vertical-align: middle;
}
@keyframes board-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0; }
}

/* Queue success */
.board-queue-success       { padding: 30px 20px; text-align: center; }
.board-queue-success-icon  { font-size: 32px; color: var(--board-green); margin-bottom: 12px; }
.board-queue-success-title {
  font-family: var(--board-mono);
  font-size: 16px;
  color: var(--board-text-bright);
  margin-bottom: 8px;
}
.board-queue-success-meta  { font-size: 11px; color: var(--board-muted); }

/* ── QUEUE VIEW ── */
.board-queue-view {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}
.board-queue-view::-webkit-scrollbar       { width: 5px; }
.board-queue-view::-webkit-scrollbar-thumb { background: var(--board-border2); }
.board-queue-view-inner { padding: 16px; }
.board-view-header {
  font-family: var(--board-mono);
  font-size: 22px;
  color: var(--board-text-bright);
  margin-bottom: 6px;
}
.board-view-sub {
  font-size: 11px;
  color: var(--board-muted);
  margin-bottom: 16px;
}
.board-pipeline-stages {
  display: flex;
  gap: 0;
  margin-bottom: 20px;
  overflow: hidden;
  border-radius: 3px;
  border: 1px solid var(--board-border);
}
.board-stage {
  flex: 1;
  padding: 10px 8px;
  text-align: center;
  font-size: 10px;
  font-weight: 600;
  border-right: 1px solid var(--board-border);
  cursor: pointer;
  transition: all 0.15s;
}
.board-stage:last-child { border-right: none; }
.board-stage:hover      { background: var(--board-bg3); }
.board-stage-name {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 3px;
}
.board-stage-count {
  font-size: 18px;
  font-family: var(--board-mono);
  font-weight: 700;
}

/* Queue table */
.board-queue-table       { width: 100%; border-collapse: collapse; }
.board-queue-table th {
  text-align: left;
  padding: 7px 10px;
  font-size: 9px;
  font-weight: 700;
  color: var(--board-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  border-bottom: 1px solid var(--board-border);
  background: var(--board-bg1);
}
.board-queue-table td {
  padding: 10px;
  font-size: 11px;
  border-bottom: 1px solid var(--board-border);
  vertical-align: middle;
}
.board-queue-table tr:hover td { background: var(--board-bg2); }
.board-queue-pos {
  color: var(--board-muted);
  font-size: 16px;
  font-family: var(--board-mono);
}
.board-queue-row-title {
  font-family: var(--board-mono);
  font-size: 13px;
  color: var(--board-text-bright);
  margin-bottom: 3px;
}
.board-queue-row-meta { font-size: 10px; color: var(--board-muted); }
.board-score-num {
  font-family: var(--board-mono);
  font-size: 18px;
  font-weight: 700;
}
.board-status-pill {
  font-size: 9px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 2px;
  text-transform: uppercase;
  white-space: nowrap;
}
.board-st-watching    { background: var(--board-bg4);       color: var(--board-muted2); }
.board-st-researching { background: var(--board-blue-dim);  color: var(--board-blue); }
.board-st-scripting   { background: var(--board-amber-dim); color: var(--board-amber); }
.board-st-filming     { background: var(--board-purple-dim);color: var(--board-purple); }
.board-st-editing     { background: var(--board-cyan-dim);  color: var(--board-cyan); }
.board-st-published   { background: var(--board-green-dim); color: var(--board-green); }
.board-queue-format   { font-size: 11px; color: var(--board-muted2); }
.board-queue-target   { font-size: 11px; color: var(--board-text); }
.board-queue-assigned { font-size: 11px; }

/* ── COMPETITOR VIEW ── */
.board-competitor-view {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}
.board-competitor-view::-webkit-scrollbar       { width: 5px; }
.board-competitor-view::-webkit-scrollbar-thumb { background: var(--board-border2); }
.board-competitor-view-inner { padding: 16px; }
.board-comp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 16px;
}
.board-comp-card {
  background: var(--board-bg2);
  border: 1px solid var(--board-border);
  border-radius: 3px;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.board-comp-card:hover {
  border-color: var(--board-border2);
  background: var(--board-bg3);
}
.board-comp-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 3px;
}
.board-comp-name {
  font-family: var(--board-mono);
  font-size: 14px;
  color: var(--board-text-bright);
}
.board-comp-subs   { font-size: 10px; color: var(--board-muted); }
.board-comp-latest { font-size: 11px; color: var(--board-text); margin-top: 7px; line-height: 1.4; }
.board-comp-time   { font-size: 10px; color: var(--board-muted); margin-top: 4px; }
.board-comp-alert {
  display: inline-block;
  font-size: 9px;
  background: var(--board-red-dim);
  color: var(--board-red);
  padding: 2px 6px;
  border-radius: 2px;
  font-weight: 700;
}
.board-tier-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 8px;
}
.board-tier-label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--board-border);
}

/* ── SOURCES VIEW ── */
.board-sources-view {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}
.board-sources-view::-webkit-scrollbar       { width: 5px; }
.board-sources-view::-webkit-scrollbar-thumb { background: var(--board-border2); }
.board-sources-view-inner { padding: 16px; }
.board-sources-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.board-src-cat-card {
  background: var(--board-bg2);
  border: 1px solid var(--board-border);
  border-radius: 3px;
  padding: 12px 14px;
}
.board-src-cat-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--board-border);
}
.board-src-cat-item {
  font-size: 11px;
  color: var(--board-text);
  padding: 4px 0;
  border-bottom: 1px solid var(--board-border);
  display: flex;
  align-items: center;
  gap: 6px;
}
.board-src-cat-item:last-child { border-bottom: none; }
.board-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--board-green);
  flex-shrink: 0;
}
.board-src-pill {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--board-cyan);
  background: var(--board-cyan-dim);
  padding: 2px 5px;
  border-radius: 999px;
}
.board-clip-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--board-border);
  border-radius: 4px;
  background: var(--board-bg2);
}
.board-clip-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.board-clip-time {
  margin-left: auto;
  font-size: 10px;
  color: var(--board-muted);
}
.board-clip-description {
  font-size: 11px;
  line-height: 1.5;
  color: var(--board-text);
}
.board-clip-embed-shell {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.board-clip-embed {
  min-height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--board-border);
  border-radius: 4px;
  background: var(--board-bg);
  overflow: hidden;
}
.board-clip-embed iframe {
  max-width: 100%;
}
.board-clip-fallback {
  font-size: 11px;
  color: var(--board-cyan);
  text-decoration: none;
}

/* ── GLOBAL SCROLLBARS ── */
.board-root ::-webkit-scrollbar       { width: 5px; height: 5px; }
.board-root ::-webkit-scrollbar-track { background: transparent; }
.board-root ::-webkit-scrollbar-thumb { background: var(--board-border2); border-radius: 3px; }
`;
