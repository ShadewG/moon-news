"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

import type {
  BoardBootstrapPayload,
  BoardStorySummary,
  BoardCompetitorChannelSummary,
} from "@/server/services/board";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SidebarView = "board" | "queue" | "competitor" | "sources";
type BoardFilter = "all" | "trending" | "controversy" | "competitor" | "correction";
type StoryStatus = "all" | "developing" | "watching" | "peaked" | "queued" | "archived";
type SortBy = "score" | "recent" | "controversy" | "sources";
type AiToolKind = "brief" | "script_starter" | "titles" | "queue" | "footage" | "research";

interface AiToolState {
  kind: AiToolKind | null;
  loading: boolean;
  content: string | null;
  items: string[];
  error: string | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BoardClient({ data }: { data: BoardBootstrapPayload }) {
  const [currentView, setCurrentView] = useState<SidebarView>("board");
  const [currentFilter, setCurrentFilter] = useState<BoardFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StoryStatus>("all");
  const [sortBy, setSortBy] = useState<SortBy>("score");
  const [verticalFilter, setVerticalFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStory, setSelectedStory] = useState<BoardStorySummary | null>(
    null,
  );
  const [clock, setClock] = useState("");
  const [researchLoading, setResearchLoading] = useState<string | null>(null);
  const [aiTool, setAiTool] = useState<AiToolState>({
    kind: null,
    loading: false,
    content: null,
    items: [],
    error: null,
  });

  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* -- derived data -- */
  const stories = data.stories.stories.map((s) => ({
    ...s,
    canonicalTitle: decodeHtml(s.canonicalTitle),
  }));
  const queueItems = data.queue;
  const competitors = data.competitors;
  const sources = data.sources;
  const health = data.health;
  const ticker = data.ticker;

  const surgeStories = stories.filter(
    (s) => (s.surgeScore >= 88 && s.sourcesCount >= 2) || (s.storyType === "trending" && s.surgeScore >= 85),
  );
  const topSurge =
    surgeStories.length > 0
      ? surgeStories.reduce((a, b) => (a.score > b.score ? a : b))
      : null;

  /* -- filtering + sorting -- */
  const filteredStories = stories
    .filter((s) => {
      // Type filter
      if (currentFilter === "trending") return s.storyType === "trending" || s.surgeScore >= 75;
      if (currentFilter === "controversy") return s.storyType === "controversy" || s.controversyScore >= 70;
      if (currentFilter === "competitor") return s.storyType === "competitor";
      if (currentFilter === "correction") return s.correction;

      // Status filter
      if (statusFilter !== "all" && s.status !== statusFilter) return false;

      // Vertical filter
      if (verticalFilter !== "all" && (s.vertical ?? "") !== verticalFilter) return false;

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

  /* -- cleanup typing timer -- */
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

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

  const handleAiTool = useCallback(
    async (storyId: string, kind: AiToolKind) => {
      if (kind === "footage") {
        window.open(`/library?q=${encodeURIComponent(selectedStory?.canonicalTitle ?? "")}`, "_blank");
        return;
      }
      if (kind === "research") {
        if (selectedStory) handleTriggerResearch(selectedStory.slug);
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
    [selectedStory],
  );

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                          */
  /* ---------------------------------------------------------------- */

  const sourceChipClass = (kind: string) => {
    if (kind === "youtube_channel" || kind === "yt")
      return "board-source-chip board-source-yt";
    if (kind === "x_account" || kind === "x")
      return "board-source-chip board-source-x";
    if (kind === "news" || kind === "rss")
      return "board-source-chip board-source-news";
    return "board-source-chip";
  };

  const sourceIcon = (kind: string) => {
    if (kind === "youtube_channel" || kind === "yt") return "\u25B6 ";
    if (kind === "x_account" || kind === "x") return "\uD835\uDD4F ";
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
            {stories.length}
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
        id: "competitor",
        icon: "\u25CE",
        label: "Competitors",
        badge:
          competitors.stats.hotCount > 0 ? (
            <span className="board-nav-badge board-badge-red">
              {competitors.stats.hotCount}
            </span>
          ) : null,
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
          RSS Feeds
          <span className="board-source-count">
            {health.enabledSources} active
          </span>
        </div>
        <div className="board-source-row">
          <span className="board-dot live" />
          YouTube RSS
          <span className="board-source-count">
            {sources.sources.filter((s) => s.kind === "youtube_channel").length}{" "}
            live
          </span>
        </div>
        <div className="board-source-row">
          <span
            className={`board-dot${health.staleSources > 2 ? " warn" : " live"}`}
          />
          Twitter/X
          <span className="board-source-count">RSS.app &#10003;</span>
        </div>

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

  const handleTriggerResearch = useCallback(async (storySlug: string) => {
    setResearchLoading(storySlug);
    try {
      await fetch(`/api/board/stories/${storySlug}/research`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "quick" }) });
    } catch { /* best effort */ }
    setResearchLoading(null);
  }, []);

  const renderTopbar = () => {
    const typeFilters: { id: BoardFilter; label: string }[] = [
      { id: "all", label: "all" },
      { id: "trending", label: "trending" },
      { id: "controversy", label: "controversy" },
      { id: "competitor", label: "competitor" },
      { id: "correction", label: "corrections" },
    ];

    const selectCls = "board-filter-select";

    return (
      <>
        {/* Stats bar — FOIA style with pipes */}
        <div className="board-stats-bar">
          <span>{filteredStories.length} shown</span>
          <span className="board-pipe">|</span>
          <span>{stories.length} total</span>
          <span className="board-pipe">|</span>
          <span style={{ color: "var(--board-amber)" }}>{surgeStories.length} surge</span>
          <span className="board-pipe">|</span>
          <span>{health.correctionCount} corrections</span>
          <span className="board-pipe">|</span>
          <span>{health.healthySources}/{sources.sources.length} sources</span>
          <span className="board-pipe">|</span>
          <span>{health.competitorAlerts} alerts</span>
          <span className="board-pipe">|</span>
          <span className="board-topbar-clock">{clock}</span>
        </div>

        {/* View tabs */}
        <div className="board-topbar">
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
    const sentPct = Math.abs(story.sentimentScore) * 100;
    const sentDir = story.sentimentScore < 0 ? "neg" : "pos";
    const contPct = story.controversyScore;

    return (
      <div
        key={story.id}
        className={`board-story-card ${storyTypeToCardClass(story.storyType)}${isActive ? " active" : ""}`}
        style={{ animationDelay: `${Math.min(index, 5) * 0.05}s` }}
        onClick={() => handleSelectStory(story)}
      >
        {/* Header */}
        <div className="board-card-header">
          <div className={`board-card-score ${scoreColorClass(story.score)}`}>
            {story.score}
          </div>
          <div className="board-card-title-block">
            <div className="board-card-title">{story.canonicalTitle}</div>
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
          {story.formats.map((f) => (
            <span key={f} className="board-badge-pill board-badge-format">
              {f}
            </span>
          ))}
        </div>

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
            className="board-btn board-btn-queue"
            onClick={(e) => {
              e.stopPropagation();
              handleSelectStory(story);
              setTimeout(() => handleAiTool(story.id, "queue"), 50);
            }}
          >
            {"\u25B6"} Add to Queue
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
            className="board-btn board-btn-title"
            onClick={(e) => {
              e.stopPropagation();
              handleSelectStory(story);
              setTimeout(() => handleAiTool(story.id, "titles"), 50);
            }}
          >
            {"\u25C8"} Titles
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

    return (
      <>
        {/* Story metrics */}
        <div className="board-panel-section">
          <div className="board-panel-section-title">Story Metrics</div>
          <div className="board-detail-row">
            <span className="board-detail-key">Moon Score</span>
            <span
              className={`board-detail-val ${scoreColorClass(s.score) === "board-score-high" ? "board-val-cyan" : scoreColorClass(s.score) === "board-score-med" ? "board-val-amber" : ""}`}
            >
              {s.score}
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
        </div>

        {/* Sources list */}
        <div className="board-panel-section">
          <div className="board-panel-section-title">
            Sources ({s.sourcePreviews.length})
          </div>
          {s.sourcePreviews.map((src) => (
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
                <span style={{ marginLeft: "auto", color: "var(--board-muted)", fontSize: "9px" }}>↗</span>
              </div>
              <div className="board-src-meta">
                {decodeHtml(src.title)}
                {src.publishedAt
                  ? ` \u00B7 ${formatTimeAgo(src.publishedAt)}`
                  : ""}
              </div>
            </a>
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
              onClick={() => handleAiTool(s.id, "script_starter")}
            >
              {"\u270D"} Script Starter &mdash; opening draft
            </button>
            <button
              className="board-btn board-btn-title board-btn-wide"
              onClick={() => handleAiTool(s.id, "titles")}
            >
              {"\u25C8"} Title Generator &mdash; 5 options
            </button>
            <button
              className="board-btn board-btn-queue board-btn-wide"
              onClick={() => handleAiTool(s.id, "queue")}
            >
              {"\u25B6"} Add to Video Queue
            </button>
            <button
              className="board-btn board-btn-footage board-btn-wide"
              onClick={() => handleAiTool(s.id, "footage")}
            >
              {"\uD83C\uDFA5"} Find Footage
            </button>
            <button
              className="board-btn board-btn-wide"
              style={{ background: "var(--board-blue-dim)", color: "var(--board-blue)" }}
              onClick={() => handleAiTool(s.id, "research")}
              disabled={researchLoading === s.slug}
            >
              {researchLoading === s.slug ? "researching..." : "\uD83D\uDD0D Deep Research"}
            </button>
          </div>
        </div>

        {/* AI output */}
        {renderAiOutput()}
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
  /*  BOARD VIEW                                                       */
  /* ---------------------------------------------------------------- */

  const renderBoardView = () => (
    <div className="board-content-area">
      <div className="board-board-view">
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
          {sources.sources.length} sources &middot; Polled every 15 minutes
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
            {currentView === "competitor" && renderCompetitorsView()}
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

@keyframes board-fadeInUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
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

/* ── GLOBAL SCROLLBARS ── */
.board-root ::-webkit-scrollbar       { width: 5px; height: 5px; }
.board-root ::-webkit-scrollbar-track { background: transparent; }
.board-root ::-webkit-scrollbar-thumb { background: var(--board-border2); border-radius: 3px; }
`;
