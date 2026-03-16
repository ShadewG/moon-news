"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";

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
  createdAt: string;
};

type LibraryData = {
  clips: Clip[];
  stats: {
    totalClips: number;
    totalTranscripts: number;
    totalQuotes: number;
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
    page: number;
    limit: number;
  };
};

export default function LibraryClient({
  initialData,
}: {
  initialData: LibraryData;
}) {
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState(initialData.query.q);
  const [provider, setProvider] = useState<ProviderFilter>(initialData.query.provider);
  const [sort, setSort] = useState<SortBy>(initialData.query.sort);
  const [transcriptOnly, setTranscriptOnly] = useState(
    initialData.query.transcriptOnly
  );
  const [page, setPage] = useState(initialData.query.page);
  const deferredSearch = useDeferredValue(search);
  const hydrated = useRef(false);
  const normalizedDeferredSearch = deferredSearch.trim();
  const isLoading =
    data.query.q !== normalizedDeferredSearch ||
    data.query.provider !== provider ||
    data.query.sort !== sort ||
    data.query.transcriptOnly !== transcriptOnly ||
    data.query.page !== page;

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams();
    if (normalizedDeferredSearch) params.set("q", normalizedDeferredSearch);
    if (provider !== "all") params.set("provider", provider);
    if (sort !== "recent") params.set("sort", sort);
    if (transcriptOnly) params.set("transcriptOnly", "true");
    params.set("page", String(page));
    params.set("limit", String(data.pageInfo.limit));

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
  }, [data.pageInfo.limit, normalizedDeferredSearch, page, provider, sort, transcriptOnly]);

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
              placeholder="Search clips, channels, transcripts..."
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-[#18181b] bg-[#111114] text-sm text-[#e4e4e7] placeholder-[#3f3f46] outline-none focus:border-[#27272a]"
            />

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
  const isYT = clip.provider === "youtube";
  const dur = clip.durationMs
    ? `${Math.floor(clip.durationMs / 60000)}:${String(
        Math.floor((clip.durationMs % 60000) / 1000)
      ).padStart(2, "0")}`
    : "";
  const hasPreview = !isYT && Boolean(clip.previewUrl);

  return (
    <a
      href={`/clips/${clip.id}`}
      className="rounded-lg border border-[#18181b] bg-[#0f0f12] overflow-hidden hover:border-[#27272a] transition-colors group"
    >
      {isYT ? (
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
      ) : hasPreview ? (
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
      ) : (
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
      )}

      <div className="px-3 py-2">
        {!hasPreview && (
          <p className="text-[11px] text-[#d4d4d8] line-clamp-2 leading-snug group-hover:text-white">
            {decode(clip.title)}
          </p>
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
        </div>
        {showMatch && clip.transcriptMatch && (
          <p className="text-[11px] text-[#71717a] mt-2 line-clamp-3">
            …{decode(clip.transcriptMatch)}…
          </p>
        )}
      </div>
    </a>
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
    </div>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span
      className={`text-[9px] px-1 py-0.5 rounded ${
        provider === "twitter"
          ? "bg-sky-500/10 text-sky-400"
          : provider === "youtube"
            ? "bg-red-500/10 text-red-400"
            : "bg-amber-500/10 text-amber-400"
      }`}
    >
      {provider === "twitter"
        ? "X"
        : provider === "youtube"
          ? "YouTube"
          : "Archive"}
    </span>
  );
}

function decode(text: string) {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&");
}
