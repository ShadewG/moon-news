"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";

import { buildDirectLibraryOpenHref } from "@/lib/library-quotes";

type ProviderFilter = "all" | "youtube" | "twitter" | "internet_archive";
type SortBy = "recent" | "views" | "quotes" | "duration";

type Clip = {
  id: string;
  provider: string;
  externalId: string;
  title: string;
  sourceUrl: string;
  previewUrl: string | null;
  channelOrContributor: string | null;
  durationMs: number | null;
  viewCount: number | null;
  uploadDate: string | null;
  hasTranscript: boolean;
  quoteCount: number;
  transcriptMatch: string | null;
  quoteMatch: string | null;
  topQuoteText: string | null;
  transcriptWordCount: number | null;
  isMoonVideo: boolean;
  createdAt: string;
};

type LibraryData = {
  clips: Clip[];
  stats: {
    totalClips: number;
    totalTranscripts: number;
    totalQuotes: number;
    totalQuotedClips: number;
    providerCounts: Record<string, number>;
  };
  pageInfo: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  query: {
    q: string;
    provider: ProviderFilter;
    sort: SortBy;
    transcriptOnly: boolean;
    quoteOnly: boolean;
    moonOnly: boolean;
    page: number;
    limit: number;
  };
};

const EMPTY_DATA: LibraryData = {
  clips: [],
  stats: { totalClips: 0, totalTranscripts: 0, totalQuotes: 0, totalQuotedClips: 0, providerCounts: {} },
  pageInfo: { page: 1, limit: 48, totalCount: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
  query: { q: "", provider: "all", sort: "recent", transcriptOnly: false, quoteOnly: false, moonOnly: false, page: 1, limit: 48 },
};

export default function LibraryClient({
  initialData,
}: {
  initialData: LibraryData | null;
}) {
  const resolvedInitialData = initialData ?? EMPTY_DATA;
  const [data, setData] = useState<LibraryData>(resolvedInitialData);
  const [search, setSearch] = useState(resolvedInitialData.query.q);
  const [provider, setProvider] = useState<ProviderFilter>(resolvedInitialData.query.provider);
  const [sort, setSort] = useState<SortBy>(resolvedInitialData.query.sort);
  const [transcriptOnly, setTranscriptOnly] = useState(resolvedInitialData.query.transcriptOnly);
  const [quoteOnly, setQuoteOnly] = useState(resolvedInitialData.query.quoteOnly);
  const [moonOnly, setMoonOnly] = useState(resolvedInitialData.query.moonOnly);
  const [page, setPage] = useState(resolvedInitialData.query.page);
  const deferredSearch = useDeferredValue(search);
  const hydrated = useRef(false);
  const normalizedDeferredSearch = deferredSearch.trim();
  const directOpenHref = buildDirectLibraryOpenHref(search);
  const isLoading =
    data.query.q !== normalizedDeferredSearch ||
    data.query.provider !== provider ||
    data.query.sort !== sort ||
    data.query.transcriptOnly !== transcriptOnly ||
    data.query.quoteOnly !== quoteOnly ||
    data.query.moonOnly !== moonOnly ||
    data.query.page !== page;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (normalizedDeferredSearch) params.set("q", normalizedDeferredSearch);
    if (provider !== "all") params.set("provider", provider);
    if (sort !== "recent") params.set("sort", sort);
    if (transcriptOnly) params.set("transcriptOnly", "true");
    if (quoteOnly) params.set("quoteOnly", "true");
    if (moonOnly) params.set("moonOnly", "true");
    params.set("page", String(page));
    params.set("limit", "48");

    fetch(`/api/library?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Library request failed: ${response.status}`);
        }

        const nextData = (await response.json()) as LibraryData;
        setData(nextData);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        console.error(error);
      });

    return () => controller.abort();
  }, [moonOnly, normalizedDeferredSearch, page, provider, quoteOnly, sort, transcriptOnly]);

  const resultStart = data.pageInfo.totalCount === 0
    ? 0
    : (data.pageInfo.page - 1) * data.pageInfo.limit + 1;
  const resultEnd = Math.min(
    data.pageInfo.totalCount,
    resultStart + data.clips.length - 1
  );

  return (
    <div className="min-h-screen bg-[#09090b] text-[#d4d4d8]">
      <header className="border-b border-[#18181b] bg-[#0c0c0e]">
        <div className="max-w-6xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest mb-1">
                Moon News Studio
              </p>
              <h1 className="text-lg font-semibold text-white">Clip Library</h1>
              <p className="text-[11px] text-[#52525b] mt-1">
                Search titles, channels, transcripts, and saved quotes across the writer library.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-[#52525b] flex-wrap justify-end">
              <span>
                <b className="text-[#a1a1aa]">{data.stats.totalClips}</b> clips
              </span>
              <span>
                <b className="text-[#a1a1aa]">{data.stats.totalTranscripts}</b> transcripts
              </span>
              <span>
                <b className="text-[#a1a1aa]">{data.stats.totalQuotes}</b> quotes
              </span>
              <span>
                <b className="text-[#a1a1aa]">{data.stats.totalQuotedClips}</b> quoted clips
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <input
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && directOpenHref) {
                  window.location.assign(directOpenHref);
                }
              }}
              placeholder="Search clips, channels, transcripts, quotes, or paste a video link..."
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-[#18181b] bg-[#111114] text-sm text-[#e4e4e7] placeholder-[#3f3f46] outline-none focus:border-[#27272a]"
            />

            {directOpenHref && (
              <a
                href={directOpenHref}
                className="px-3 py-2 rounded-lg border border-cyan-500/25 bg-cyan-500/10 text-[11px] text-cyan-200 hover:bg-cyan-500/15"
              >
                Open Exact Video
              </a>
            )}

            <div className="flex rounded-lg border border-[#18181b] overflow-hidden">
              {(["all", "youtube", "twitter", "internet_archive"] as ProviderFilter[]).map(
                (value) => (
                  <button
                    key={value}
                    onClick={() => {
                      setProvider(value);
                      setPage(1);
                    }}
                    className={`px-3 py-1.5 text-[11px] transition-colors ${
                      provider === value
                        ? "bg-[#18181b] text-white"
                        : "text-[#52525b] hover:text-[#a1a1aa]"
                    }`}
                  >
                    {value === "all"
                      ? "All"
                      : value === "youtube"
                        ? "YouTube"
                        : value === "twitter"
                          ? "X"
                          : "Archive"}
                    <span className="ml-1 text-[#3f3f46]">
                      {data.stats.providerCounts[value] ?? 0}
                    </span>
                  </button>
                )
              )}
            </div>

            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as SortBy);
                setPage(1);
              }}
              className="px-2 py-1.5 rounded-lg border border-[#18181b] bg-[#111114] text-[11px] text-[#a1a1aa] outline-none"
            >
              <option value="recent">Most Recent</option>
              <option value="views">Most Views</option>
              <option value="quotes">Most Quotes</option>
              <option value="duration">Longest</option>
            </select>

            <button
              onClick={() => {
                setTranscriptOnly((current) => !current);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-[11px] border transition-colors ${
                transcriptOnly
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-[#18181b] text-[#52525b] hover:text-[#a1a1aa]"
              }`}
            >
              Has Transcript
            </button>

            <button
              onClick={() => {
                setQuoteOnly((current) => !current);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-[11px] border transition-colors ${
                quoteOnly
                  ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                  : "border-[#18181b] text-[#52525b] hover:text-[#a1a1aa]"
              }`}
            >
              Has Quotes
            </button>

            <button
              onClick={() => {
                setMoonOnly((current) => !current);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-[11px] border transition-colors ${
                moonOnly
                  ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                  : "border-[#18181b] text-[#52525b] hover:text-[#a1a1aa]"
              }`}
            >
              Moon Only
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-3 text-xs text-[#3f3f46] flex items-center justify-between gap-3">
        <span>
          {data.pageInfo.totalCount} clip{data.pageInfo.totalCount !== 1 ? "s" : ""}
          {normalizedDeferredSearch && ` matching "${normalizedDeferredSearch}"`}
          {data.pageInfo.totalCount > 0 && (
            <> · showing {resultStart}-{resultEnd}</>
          )}
        </span>
        {isLoading && <span className="text-[#71717a]">Updating…</span>}
      </div>

      <main className="max-w-6xl mx-auto px-6 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {data.clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} showMatch={Boolean(normalizedDeferredSearch)} />
          ))}
        </div>

        {data.clips.length === 0 && (
          <p className="text-sm text-[#3f3f46] text-center py-16">
            No clips match your filters
          </p>
        )}

        {data.pageInfo.totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={!data.pageInfo.hasPreviousPage || isLoading}
              className="px-3 py-2 rounded-lg border border-[#18181b] text-xs text-[#a1a1aa] disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-xs text-[#52525b]">
              Page {data.pageInfo.page} of {data.pageInfo.totalPages}
            </span>
            <button
              onClick={() =>
                setPage((current) =>
                  Math.min(data.pageInfo.totalPages, current + 1)
                )
              }
              disabled={!data.pageInfo.hasNextPage || isLoading}
              className="px-3 py-2 rounded-lg border border-[#18181b] text-xs text-[#a1a1aa] disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function ClipCard({
  clip,
  showMatch,
}: {
  clip: Clip;
  showMatch: boolean;
}) {
  const [genState, setGenState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [genCount, setGenCount] = useState(0);

  async function generateQuotes(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (genState === "done") {
      // Already generated — navigate to quotes page
      window.location.href = `/clips/${clip.id}?tab=quotes`;
      return;
    }
    setGenState("loading");
    try {
      const res = await fetch(`/api/clips/${clip.id}/quote-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ save: true }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setGenCount(data.quotes?.length ?? 0);
      setGenState("done");
    } catch {
      setGenState("error");
    }
  }

  const isYT = clip.provider === "youtube";
  const dur = clip.durationMs
    ? `${Math.floor(clip.durationMs / 60000)}:${String(
        Math.floor((clip.durationMs % 60000) / 1000)
      ).padStart(2, "0")}`
    : "";
  const hasPreview = !isYT && Boolean(clip.previewUrl);
  const previewLabel = clip.quoteMatch
    ? "Quote match"
    : showMatch && clip.transcriptMatch
      ? "Transcript match"
      : clip.topQuoteText
        ? "Top quote"
        : null;
  const previewBody = clip.quoteMatch ?? (showMatch ? clip.transcriptMatch : null) ?? clip.topQuoteText;
  const clipHref = `/clips/${clip.id}`;

  return (
    <div
      className="rounded-lg border border-[#18181b] bg-[#0f0f12] overflow-hidden hover:border-[#27272a] transition-colors group"
    >
      {isYT ? (
        <a href={clipHref} className="block">
          <div className="relative aspect-video bg-[#111114]">
            <img
              src={`https://i.ytimg.com/vi/${clip.externalId}/hqdefault.jpg`}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity">
              <div className="w-10 h-7 bg-red-600 rounded-md flex items-center justify-center">
                <svg
                  viewBox="0 0 24 24"
                  className="w-3 h-3 text-white ml-0.5"
                  fill="currentColor"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
            {dur && (
              <span className="absolute bottom-1.5 right-1.5 text-[9px] font-mono bg-black/70 text-white px-1 py-0.5 rounded">
                {dur}
              </span>
            )}
            <CardBadges clip={clip} />
          </div>
        </a>
      ) : hasPreview ? (
        <a href={clipHref} className="block">
          <div className="relative aspect-video bg-[#111114]">
            <img
              src={clip.previewUrl ?? undefined}
              alt=""
              className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#09090b] via-transparent to-transparent" />
            <div className="absolute top-1.5 left-1.5">
              <ProviderBadge provider={clip.provider} />
            </div>
            <div className="absolute bottom-2 left-2 right-2">
              <p className="text-[11px] text-white line-clamp-2 leading-snug">
                {decode(clip.title)}
              </p>
            </div>
          </div>
        </a>
      ) : (
        <a href={clipHref} className="block">
          <div className="p-3 bg-[#111114] min-h-[96px] flex flex-col justify-between">
            <p className="text-[11px] text-[#d4d4d8] line-clamp-3 leading-relaxed">
              {decode(clip.title)}
            </p>
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              <ProviderBadge provider={clip.provider} />
              {clip.quoteCount > 0 && (
                <span className="text-[8px] bg-violet-500/20 text-violet-400 px-1 py-0.5 rounded">
                  {clip.quoteCount} quotes
                </span>
              )}
            </div>
          </div>
        </a>
      )}

      <div className="px-3 py-2">
        {!hasPreview && (
          <a href={clipHref} className="block text-[11px] text-[#d4d4d8] line-clamp-2 leading-snug group-hover:text-white">
            {decode(clip.title)}
          </a>
        )}
        <div className="flex items-center gap-2 mt-1 text-[10px] text-[#3f3f46] flex-wrap">
          {clip.channelOrContributor && (
            <span className="text-[#52525b] truncate">{clip.channelOrContributor}</span>
          )}
          {clip.viewCount != null && clip.viewCount > 0 && (
            <span>{clip.viewCount.toLocaleString()} views</span>
          )}
          {clip.uploadDate && (
            <span>{clip.uploadDate.slice(0, 10)}</span>
          )}
          {clip.transcriptWordCount != null && clip.transcriptWordCount > 0 && (
            <span>{Math.round(clip.transcriptWordCount / 100) / 10}k words</span>
          )}
        </div>
        {previewLabel && previewBody && (
          <div className="mt-3 rounded-md border border-[#18181b] bg-[#111114] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-[#52525b]">{previewLabel}</div>
            <p className="mt-1 text-[11px] text-[#9ca3af] line-clamp-4 leading-relaxed">
              {previewLabel === "Transcript match" ? `…${decode(previewBody)}…` : `“${decode(previewBody)}”`}
            </p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {clip.quoteCount > 0 && (
            <a
              href={`/clips/${clip.id}?tab=quotes`}
              className="rounded-md border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-[10px] text-violet-200 hover:bg-violet-500/15"
            >
              Quotes
            </a>
          )}
          {clip.hasTranscript && (
            <a
              href={`/clips/${clip.id}?tab=transcript`}
              className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] text-amber-200 hover:bg-amber-500/15"
            >
              Transcript
            </a>
          )}
          {clip.hasTranscript && (
            <a
              href={`/clips/${clip.id}?tab=ask`}
              className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] text-cyan-200 hover:bg-cyan-500/15"
            >
              Ask
            </a>
          )}
          {clip.hasTranscript && (
            <button
              onClick={generateQuotes}
              disabled={genState === "loading"}
              className={`rounded-md border px-2.5 py-1 text-[10px] cursor-pointer disabled:cursor-wait ${
                genState === "done"
                  ? "border-violet-500/20 bg-violet-500/10 text-violet-200 hover:bg-violet-500/15"
                  : genState === "error"
                    ? "border-red-500/20 bg-red-500/10 text-red-200"
                    : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-50"
              }`}
            >
              {genState === "loading" ? "Analyzing..." : genState === "done" ? `View ${genCount} quotes →` : genState === "error" ? "Failed — retry" : "Generate Quotes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CardBadges({ clip }: { clip: Clip }) {
  return (
    <div className="absolute top-1.5 left-1.5 flex gap-1 flex-wrap">
      {clip.hasTranscript && (
        <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1 py-0.5 rounded">
          Transcript
        </span>
      )}
      {clip.quoteCount > 0 && (
        <span className="text-[8px] bg-violet-500/20 text-violet-400 px-1 py-0.5 rounded">
          {clip.quoteCount} quotes
        </span>
      )}
      {clip.isMoonVideo && (
        <span className="text-[8px] bg-cyan-500/20 text-cyan-300 px-1 py-0.5 rounded">
          Moon
        </span>
      )}
    </div>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const label =
    provider === "twitter"
      ? "X"
      : provider === "youtube"
        ? "YouTube"
        : provider === "internet_archive"
          ? "Archive"
          : provider
              .replace(/_/g, " ")
              .replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <span
      className={`text-[9px] px-1 py-0.5 rounded ${
        provider === "twitter"
          ? "bg-sky-500/10 text-sky-400"
          : provider === "youtube"
            ? "bg-red-500/10 text-red-400"
            : provider === "internet_archive"
              ? "bg-amber-500/10 text-amber-400"
              : "bg-zinc-500/10 text-zinc-300"
      }`}
    >
      {label}
    </span>
  );
}

function decode(text: string) {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&");
}
