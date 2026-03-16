"use client";

import { useState, useMemo } from "react";

type Clip = {
  id: string; provider: string; externalId: string; title: string;
  sourceUrl: string; previewUrl: string | null; channelOrContributor: string | null;
  durationMs: number | null; viewCount: number | null; uploadDate: string | null;
  hasTranscript: boolean; quoteCount: number; createdAt: string;
};

type ProviderFilter = "all" | "youtube" | "twitter" | "internet_archive";
type SortBy = "recent" | "views" | "quotes" | "duration";

export default function LibraryClient({ clips }: { clips: Clip[] }) {
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [sort, setSort] = useState<SortBy>("recent");
  const [transcriptOnly, setTranscriptOnly] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: clips.length };
    for (const clip of clips) c[clip.provider] = (c[clip.provider] ?? 0) + 1;
    return c;
  }, [clips]);

  const filtered = useMemo(() => {
    let result = clips;

    if (provider !== "all") result = result.filter((c) => c.provider === provider);
    if (transcriptOnly) result = result.filter((c) => c.hasTranscript);

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.channelOrContributor ?? "").toLowerCase().includes(q)
      );
    }

    switch (sort) {
      case "views":
        result = [...result].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
        break;
      case "quotes":
        result = [...result].sort((a, b) => b.quoteCount - a.quoteCount);
        break;
      case "duration":
        result = [...result].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
        break;
      // "recent" is default order from DB
    }

    return result;
  }, [clips, provider, sort, transcriptOnly, search]);

  return (
    <div className="min-h-screen bg-[#09090b] text-[#d4d4d8]">
      {/* Header */}
      <header className="border-b border-[#18181b] bg-[#0c0c0e]">
        <div className="max-w-6xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest mb-1">Moon News Studio</p>
              <h1 className="text-lg font-semibold text-white">Clip Library</h1>
            </div>
            <div className="flex items-center gap-3 text-xs text-[#52525b]">
              <span><b className="text-[#a1a1aa]">{clips.length}</b> clips</span>
              <span><b className="text-[#a1a1aa]">{clips.filter((c) => c.hasTranscript).length}</b> transcripts</span>
              <span><b className="text-[#a1a1aa]">{clips.reduce((s, c) => s + c.quoteCount, 0)}</b> quotes</span>
            </div>
          </div>

          {/* Search + Filters */}
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clips, channels..."
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-[#18181b] bg-[#111114] text-sm text-[#e4e4e7] placeholder-[#3f3f46] outline-none focus:border-[#27272a]"
            />

            {/* Provider filter */}
            <div className="flex rounded-lg border border-[#18181b] overflow-hidden">
              {(["all", "youtube", "twitter", "internet_archive"] as ProviderFilter[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`px-3 py-1.5 text-[11px] transition-colors ${
                    provider === p ? "bg-[#18181b] text-white" : "text-[#52525b] hover:text-[#a1a1aa]"
                  }`}
                >
                  {p === "all" ? "All" : p === "youtube" ? "YouTube" : p === "twitter" ? "X" : "Archive"}
                  <span className="ml-1 text-[#3f3f46]">{counts[p] ?? 0}</span>
                </button>
              ))}
            </div>

            {/* Sort */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortBy)}
              className="px-2 py-1.5 rounded-lg border border-[#18181b] bg-[#111114] text-[11px] text-[#a1a1aa] outline-none"
            >
              <option value="recent">Most Recent</option>
              <option value="views">Most Views</option>
              <option value="quotes">Most Quotes</option>
              <option value="duration">Longest</option>
            </select>

            {/* Transcript filter */}
            <button
              onClick={() => setTranscriptOnly(!transcriptOnly)}
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

      {/* Results count */}
      <div className="max-w-6xl mx-auto px-6 py-3 text-xs text-[#3f3f46]">
        {filtered.length} clip{filtered.length !== 1 ? "s" : ""}
        {search && ` matching "${search}"`}
      </div>

      {/* Grid */}
      <main className="max-w-6xl mx-auto px-6 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((clip) => (
            <ClipCard key={clip.id} clip={clip} />
          ))}
        </div>

        {filtered.length === 0 && (
          <p className="text-sm text-[#3f3f46] text-center py-16">
            No clips match your filters
          </p>
        )}
      </main>
    </div>
  );
}

function ClipCard({ clip }: { clip: Clip }) {
  const isYT = clip.provider === "youtube";
  const dur = clip.durationMs
    ? `${Math.floor(clip.durationMs / 60000)}:${String(Math.floor((clip.durationMs % 60000) / 1000)).padStart(2, "0")}`
    : "";

  return (
    <a
      href={`/clips/${clip.id}`}
      className="rounded-lg border border-[#18181b] bg-[#0f0f12] overflow-hidden hover:border-[#27272a] transition-colors group"
    >
      {/* Thumbnail */}
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
              <svg viewBox="0 0 24 24" className="w-3 h-3 text-white ml-0.5" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
          {dur && (
            <span className="absolute bottom-1.5 right-1.5 text-[9px] font-mono bg-black/70 text-white px-1 py-0.5 rounded">
              {dur}
            </span>
          )}
          {/* Badges */}
          <div className="absolute top-1.5 left-1.5 flex gap-1">
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
        </div>
      ) : (
        <div className="p-3 bg-[#111114] min-h-[80px] flex flex-col justify-between">
          <p className="text-[11px] text-[#d4d4d8] line-clamp-3 leading-relaxed">{decode(clip.title)}</p>
          <div className="flex items-center gap-1 mt-2">
            <span className={`text-[9px] px-1 py-0.5 rounded ${
              clip.provider === "twitter" ? "bg-sky-500/10 text-sky-400" : "bg-amber-500/10 text-amber-400"
            }`}>
              {clip.provider === "twitter" ? "X" : "Archive"}
            </span>
            {clip.quoteCount > 0 && (
              <span className="text-[8px] bg-violet-500/20 text-violet-400 px-1 py-0.5 rounded">
                {clip.quoteCount} quotes
              </span>
            )}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="px-3 py-2">
        {isYT && (
          <p className="text-[11px] text-[#d4d4d8] line-clamp-2 leading-snug group-hover:text-white">
            {decode(clip.title)}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1 text-[10px] text-[#3f3f46]">
          {clip.channelOrContributor && (
            <span className="text-[#52525b] truncate">{clip.channelOrContributor}</span>
          )}
          {clip.viewCount != null && clip.viewCount > 0 && (
            <span>{clip.viewCount.toLocaleString()} views</span>
          )}
        </div>
      </div>
    </a>
  );
}

function decode(t: string) {
  return t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}
