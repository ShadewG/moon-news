import { eq, desc, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  footageAssets,
  footageQuotes,
  projects,
  researchSources,
  scriptLines,
  visualRecommendations,
} from "@/server/db/schema";
import CopyLinksButton from "./copy-links";

type Props = {
  params: Promise<{ projectId: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { projectId } = await params;
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  return {
    title: project
      ? `${project.title} — Investigation Report`
      : "Investigation Report",
  };
}

export default async function ReportPage({ params }: Props) {
  const { projectId } = await params;
  const db = getDb();

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <p className="text-[#71717a]">Project not found</p>
      </div>
    );
  }

  const lines = await db
    .select()
    .from(scriptLines)
    .where(eq(scriptLines.projectId, projectId))
    .orderBy(scriptLines.lineIndex);

  const [allAssets, allQuotes, allSources, allRecs] = await Promise.all([
    db
      .select()
      .from(footageAssets)
      .innerJoin(scriptLines, eq(scriptLines.id, footageAssets.scriptLineId))
      .where(eq(scriptLines.projectId, projectId))
      .orderBy(desc(footageAssets.matchScore)),
    db
      .select()
      .from(footageQuotes)
      .innerJoin(scriptLines, eq(scriptLines.id, footageQuotes.scriptLineId))
      .where(eq(scriptLines.projectId, projectId))
      .orderBy(desc(footageQuotes.relevanceScore)),
    db
      .select()
      .from(researchSources)
      .innerJoin(scriptLines, eq(scriptLines.id, researchSources.scriptLineId))
      .where(eq(scriptLines.projectId, projectId)),
    db
      .select()
      .from(visualRecommendations)
      .where(eq(visualRecommendations.projectId, projectId)),
  ]);

  const totalVisible = allAssets.filter((a) => !a.footage_assets.filtered).length;
  const totalFiltered = allAssets.length - totalVisible;

  // Collect ALL source URLs for copy button
  const allLinks = allAssets
    .filter((a) => !a.footage_assets.filtered)
    .map((a) => a.footage_assets.sourceUrl);

  const now = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-[#09090b] text-[#e4e4e7]">
      {/* Header */}
      <header className="border-b border-[#1e1e22] bg-[#0c0c0f] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs text-[#52525b] mb-2">
                <span>Moon News Studio</span>
                <span>/</span>
                <span>Investigation Report</span>
              </div>
              <h1 className="text-xl font-bold text-white">{project.title}</h1>
              <p className="text-xs text-[#52525b] mt-1">{now}</p>
            </div>
            <CopyLinksButton links={allLinks} />
          </div>
          <div className="flex gap-6 mt-4 text-sm">
            <Stat label="Lines" value={lines.length} />
            <Stat label="Footage" value={totalVisible} />
            <Stat label="Filtered" value={totalFiltered} />
            <Stat label="Quotes" value={allQuotes.length} />
            <Stat label="Articles" value={allSources.length} />
          </div>
        </div>
      </header>

      {/* Lines */}
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {lines.map((line) => {
          const lineAssets = allAssets
            .filter((a) => a.footage_assets.scriptLineId === line.id)
            .map((a) => a.footage_assets);
          const visible = lineAssets.filter((a) => !a.filtered);
          const filtered = lineAssets.filter((a) => a.filtered);
          const lineQuotes = allQuotes
            .filter((q) => q.footage_quotes.scriptLineId === line.id)
            .map((q) => q.footage_quotes);
          const lineSources = allSources
            .filter((s) => s.research_sources.scriptLineId === line.id)
            .map((s) => s.research_sources);
          const lineRecs = allRecs.filter(
            (r) => r.scriptLineId === line.id && !r.dismissed
          );

          const byProvider: Record<string, number> = {};
          for (const a of visible)
            byProvider[a.provider] = (byProvider[a.provider] ?? 0) + 1;

          const lineLinks = visible.map((a) => a.sourceUrl);

          return (
            <section
              key={line.id}
              id={line.lineKey}
              className="border border-[#1e1e22] rounded-xl bg-[#0c0c0f] overflow-hidden"
            >
              {/* Line header */}
              <div className="px-5 py-4 border-b border-[#1e1e22] bg-[#111114]">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-mono text-[#52525b]">
                    {line.lineKey}
                  </span>
                  {line.lineContentCategory && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1e1e22] text-[#a1a1aa]">
                      {line.lineContentCategory.replace(/_/g, " ")}
                    </span>
                  )}
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1e1e22] text-[#52525b]">
                    {line.lineType}
                  </span>
                  <div className="flex-1" />
                  <div className="flex gap-1">
                    {Object.entries(byProvider).map(([p, c]) => (
                      <span
                        key={p}
                        className={`text-[10px] px-1.5 py-0.5 rounded ${pStyle(p)}`}
                      >
                        {pLabel(p)}: {c}
                      </span>
                    ))}
                  </div>
                  {lineLinks.length > 0 && (
                    <CopyLinksButton links={lineLinks} label="Copy links" small />
                  )}
                </div>
                <p className="text-sm text-[#d4d4d8] leading-relaxed">
                  {line.text}
                </p>
              </div>

              <div className="px-5 py-4 space-y-5">
                {/* Recs */}
                {lineRecs.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-start gap-2 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20 text-xs"
                  >
                    <span className="text-purple-400 mt-0.5">AI</span>
                    <div>
                      <span className="text-[#d4d4d8]">
                        Recommend {r.recommendationType.replace(/_/g, " ")}
                      </span>
                      <span className="text-[#52525b] ml-2">{r.reason}</span>
                    </div>
                  </div>
                ))}

                {/* Quotes */}
                {lineQuotes.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-semibold text-[#71717a] mb-2 uppercase tracking-widest">
                      Quotes
                    </h4>
                    {lineQuotes.map((q) => {
                      const m = Math.floor(q.startMs / 60000);
                      const s = Math.floor((q.startMs % 60000) / 1000);
                      return (
                        <div
                          key={q.id}
                          className="p-3 rounded-lg bg-[#141418] border border-[#1e1e22] mb-2"
                        >
                          <p className="text-sm text-[#d4d4d8] italic leading-relaxed">
                            &ldquo;{q.quoteText}&rdquo;
                          </p>
                          <div className="flex items-center gap-3 mt-2 text-[11px] text-[#52525b]">
                            <span className="font-mono text-[#71717a]">
                              [{m}:{String(s).padStart(2, "0")}]
                            </span>
                            {q.speaker && (
                              <span className="text-[#a1a1aa]">— {q.speaker}</span>
                            )}
                            <span>{q.relevanceScore}/100</span>
                          </div>
                          {q.context && (
                            <p className="text-[11px] text-[#3f3f46] mt-1">
                              {q.context}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Footage with embedded players */}
                {visible.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-semibold text-[#71717a] mb-3 uppercase tracking-widest">
                      Footage ({visible.length})
                    </h4>
                    <div className="space-y-3">
                      {visible.map((a) => (
                        <FootageCard key={a.id} asset={a} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Filtered */}
                {filtered.length > 0 && (
                  <details className="text-[11px] text-[#3f3f46]">
                    <summary className="cursor-pointer hover:text-[#52525b] py-1">
                      {filtered.length} filtered results
                    </summary>
                    <div className="mt-2 space-y-1 pl-3 border-l border-[#1e1e22]">
                      {filtered.map((a) => (
                        <div key={a.id} className="flex gap-2">
                          <span className="text-[#27272a] w-8 text-right flex-shrink-0">
                            {a.matchScore}
                          </span>
                          <a
                            href={a.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-[#52525b] truncate"
                          >
                            [{a.provider}] {a.title}
                          </a>
                          {a.filterReason && (
                            <span className="text-[#27272a] flex-shrink-0">
                              — {a.filterReason}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Articles */}
                {lineSources.length > 0 && (
                  <details>
                    <summary className="text-[11px] text-[#52525b] cursor-pointer hover:text-[#71717a] py-1">
                      {lineSources.length} article sources
                    </summary>
                    <div className="mt-2 space-y-1 pl-3 border-l border-[#1e1e22]">
                      {lineSources.map((s) => (
                        <a
                          key={s.id}
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-[11px] text-[#3f3f46] hover:text-[#52525b]"
                        >
                          <span className="text-[#52525b]">[{s.sourceName}]</span>{" "}
                          {s.title}
                        </a>
                      ))}
                    </div>
                  </details>
                )}

                {/* Empty states */}
                {visible.length === 0 &&
                  lineQuotes.length === 0 &&
                  lineSources.length === 0 &&
                  lineRecs.length === 0 &&
                  line.lineContentCategory === "transition" && (
                    <p className="text-xs text-[#27272a] italic">
                      Transition — no search needed
                    </p>
                  )}
              </div>
            </section>
          );
        })}
      </main>

      <footer className="border-t border-[#1e1e22] py-6 text-center text-xs text-[#27272a]">
        Moon News Studio
      </footer>
    </div>
  );
}

function FootageCard({
  asset,
}: {
  asset: typeof footageAssets.$inferSelect;
}) {
  const views = (asset.metadataJson as Record<string, unknown> | null)
    ?.viewCount;
  const isYouTube = asset.provider === "youtube";
  const isTwitter = asset.provider === "twitter";

  // Extract YouTube video ID for embed
  const ytId = isYouTube ? asset.externalAssetId : null;

  // Extract Twitter post ID for embed
  const tweetId = isTwitter
    ? asset.sourceUrl.match(/status\/(\d+)/)?.[1]
    : null;

  return (
    <div className="rounded-lg border border-[#1e1e22] bg-[#111114] overflow-hidden">
      {/* Embed */}
      {ytId && (
        <div className="aspect-video">
          <iframe
            src={`https://www.youtube.com/embed/${ytId}`}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
      {isTwitter && !ytId && (
        <div className="p-4 bg-[#0c0c0f] border-b border-[#1e1e22]">
          <p className="text-sm text-[#a1a1aa] leading-relaxed">
            {asset.title}
          </p>
          {tweetId && (
            <a
              href={asset.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-xs text-sky-400 hover:text-sky-300"
            >
              View on X →
            </a>
          )}
        </div>
      )}
      {!isYouTube && !isTwitter && asset.previewUrl && (
        <img
          src={asset.previewUrl}
          alt={asset.title}
          className="w-full h-40 object-cover"
        />
      )}

      {/* Info */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <a
              href={asset.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#d4d4d8] hover:text-white leading-snug line-clamp-2 block"
            >
              {decodeHTMLEntities(asset.title)}
            </a>
            {asset.channelOrContributor && (
              <p className="text-[11px] text-[#52525b] mt-0.5">
                {asset.channelOrContributor}
              </p>
            )}
          </div>
          <span className="text-xs font-mono text-[#52525b] flex-shrink-0">
            {asset.matchScore}pts
          </span>
        </div>
        <div className="flex items-center gap-2 mt-2 text-[10px] text-[#3f3f46] flex-wrap">
          <span className={pStyle(asset.provider)}>{pLabel(asset.provider)}</span>
          {asset.durationMs && asset.durationMs > 0 && (
            <span>
              {Math.floor(asset.durationMs / 60000)}:
              {String(Math.floor((asset.durationMs % 60000) / 1000)).padStart(2, "0")}
            </span>
          )}
          {views != null && (
            <span>{Number(views as number).toLocaleString()} views</span>
          )}
          {asset.uploadDate && (
            <span>{String(asset.uploadDate).slice(0, 10)}</span>
          )}
          {asset.licenseType && <span>{asset.licenseType}</span>}
          {asset.isPrimarySource && (
            <span className="text-amber-500">Primary Source</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-sm">
      <span className="text-white font-semibold">{value}</span>{" "}
      <span className="text-[#52525b]">{label}</span>
    </div>
  );
}

function pStyle(p: string): string {
  const m: Record<string, string> = {
    youtube: "text-red-400",
    twitter: "text-sky-400",
    internet_archive: "text-amber-400",
    google_images: "text-blue-400",
    getty: "text-emerald-400",
    storyblocks: "text-indigo-400",
  };
  return m[p] ?? "text-[#52525b]";
}

function pLabel(p: string): string {
  const m: Record<string, string> = {
    youtube: "YT",
    twitter: "X",
    internet_archive: "IA",
    google_images: "GI",
    getty: "Getty",
    storyblocks: "SB",
  };
  return m[p] ?? p;
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
