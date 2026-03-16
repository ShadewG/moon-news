import { eq, desc } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  clipLibrary,
  clipSearches,
  clipSearchResults,
  footageQuotes,
} from "@/server/db/schema";

type Props = { params: Promise<{ searchId: string }> };

export async function generateMetadata({ params }: Props) {
  const { searchId } = await params;
  const db = getDb();
  const [s] = await db
    .select()
    .from(clipSearches)
    .where(eq(clipSearches.id, searchId))
    .limit(1);
  return { title: s ? `"${s.query}" — Search Results` : "Search Results" };
}

export default async function SearchResultPage({ params }: Props) {
  const { searchId } = await params;
  const db = getDb();

  const [search] = await db
    .select()
    .from(clipSearches)
    .where(eq(clipSearches.id, searchId))
    .limit(1);

  if (!search) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center text-[#52525b]">
        Search not found
      </div>
    );
  }

  const results = await db
    .select({
      relevanceScore: clipSearchResults.relevanceScore,
      clip: clipLibrary,
    })
    .from(clipSearchResults)
    .innerJoin(clipLibrary, eq(clipLibrary.id, clipSearchResults.clipId))
    .where(eq(clipSearchResults.searchId, searchId))
    .orderBy(desc(clipSearchResults.relevanceScore));

  const yt = results.filter((r) => r.clip.provider === "youtube");
  const x = results.filter((r) => r.clip.provider === "twitter");
  const ia = results.filter((r) => r.clip.provider === "internet_archive");

  const date = search.createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-[#09090b] text-[#d4d4d8]">
      <header className="border-b border-[#18181b] bg-[#0c0c0e]">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest mb-1">
            Topic Search
          </p>
          <h1 className="text-xl font-semibold text-white">
            &ldquo;{search.query}&rdquo;
          </h1>
          <div className="flex gap-4 mt-2 text-xs text-[#52525b]">
            <span>
              <b className="text-[#a1a1aa]">{results.length}</b> clips
            </span>
            <span>
              <b className="text-[#a1a1aa]">{search.quotesCount}</b> quotes
            </span>
            <span>{date}</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* YouTube */}
        {yt.length > 0 && (
          <section>
            <h2 className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold mb-4">
              YouTube ({yt.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {yt.map((r) => (
                <a
                  key={r.clip.id}
                  href={r.clip.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-[#18181b] bg-[#0f0f12] overflow-hidden hover:border-[#27272a] transition-colors"
                >
                  <div className="relative aspect-video">
                    <img
                      src={`https://i.ytimg.com/vi/${r.clip.externalId}/hqdefault.jpg`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-50 left-50 inset-0 flex items-center justify-center">
                      <div className="w-12 h-8 bg-red-600 rounded-lg flex items-center justify-center">
                        <svg
                          viewBox="0 0 24 24"
                          className="w-4 h-4 text-white ml-0.5"
                          fill="currentColor"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                    <div className="absolute top-2 right-2 text-[10px] font-mono bg-black/70 text-white px-1.5 py-0.5 rounded">
                      {r.relevanceScore}/50
                    </div>
                    {r.clip.durationMs && (
                      <div className="absolute bottom-2 right-2 text-[9px] font-mono bg-black/70 text-white px-1.5 py-0.5 rounded">
                        {Math.floor(r.clip.durationMs / 60000)}:
                        {String(
                          Math.floor((r.clip.durationMs % 60000) / 1000)
                        ).padStart(2, "0")}
                      </div>
                    )}
                  </div>
                  <div className="px-3 py-2.5">
                    <p className="text-xs text-[#d4d4d8] leading-snug line-clamp-2">
                      {decode(r.clip.title)}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-[#3f3f46]">
                      <span className="text-[#52525b]">
                        {r.clip.channelOrContributor}
                      </span>
                      {r.clip.viewCount && (
                        <span>
                          {r.clip.viewCount.toLocaleString()} views
                        </span>
                      )}
                      {r.clip.hasTranscript && (
                        <span className="text-amber-500/50">transcript</span>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Twitter */}
        {x.length > 0 && (
          <section>
            <h2 className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold mb-4">
              X / Twitter ({x.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {x.map((r) => (
                <a
                  key={r.clip.id}
                  href={r.clip.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-4 rounded-lg bg-[#0f0f12] border border-[#18181b] hover:border-[#27272a] transition-colors block"
                >
                  <p className="text-xs text-[#d4d4d8] leading-relaxed line-clamp-3">
                    {r.clip.title}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-[#3f3f46]">
                    <span className="text-sky-400">
                      {r.clip.channelOrContributor}
                    </span>
                    {r.clip.viewCount && (
                      <span>
                        {r.clip.viewCount.toLocaleString()} views
                      </span>
                    )}
                    <span className="ml-auto">{r.relevanceScore}/50</span>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Internet Archive */}
        {ia.length > 0 && (
          <section>
            <h2 className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold mb-4">
              Internet Archive ({ia.length})
            </h2>
            <div className="space-y-2">
              {ia.map((r) => (
                <a
                  key={r.clip.id}
                  href={r.clip.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-lg bg-[#0f0f12] border border-[#18181b] hover:border-[#27272a] transition-colors"
                >
                  {r.clip.previewUrl && (
                    <img
                      src={r.clip.previewUrl}
                      alt=""
                      className="w-16 h-10 object-cover rounded flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#d4d4d8] truncate">
                      {decode(r.clip.title)}
                    </p>
                    <span className="text-[10px] text-amber-400">
                      Internet Archive
                    </span>
                  </div>
                  <span className="text-[10px] text-[#27272a]">
                    {r.relevanceScore}/50
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}

        {results.length === 0 && (
          <p className="text-sm text-[#3f3f46] text-center py-12">
            No results found
          </p>
        )}
      </main>

      <footer className="border-t border-[#18181b] py-4 text-center text-[10px] text-[#1e1e22]">
        Moon News Studio
      </footer>
    </div>
  );
}

function decode(t: string) {
  return t
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}
