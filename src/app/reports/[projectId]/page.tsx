import { eq, desc } from "drizzle-orm";

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
import { YouTubeEmbed } from "./video-embed";

type Props = { params: Promise<{ projectId: string }> };

export async function generateMetadata({ params }: Props) {
  const { projectId } = await params;
  const db = getDb();
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  return { title: p ? `${p.title} — Report` : "Report" };
}

export default async function ReportPage({ params }: Props) {
  const { projectId } = await params;
  const db = getDb();

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    return <div className="min-h-screen bg-[#09090b] flex items-center justify-center text-[#52525b]">Project not found</div>;
  }

  const lines = await db.select().from(scriptLines).where(eq(scriptLines.projectId, projectId)).orderBy(scriptLines.lineIndex);

  const [allAssets, allQuotes, allSources, allRecs] = await Promise.all([
    db.select().from(footageAssets).innerJoin(scriptLines, eq(scriptLines.id, footageAssets.scriptLineId)).where(eq(scriptLines.projectId, projectId)).orderBy(desc(footageAssets.matchScore)),
    db.select().from(footageQuotes).innerJoin(scriptLines, eq(scriptLines.id, footageQuotes.scriptLineId)).where(eq(scriptLines.projectId, projectId)).orderBy(desc(footageQuotes.relevanceScore)),
    db.select().from(researchSources).innerJoin(scriptLines, eq(scriptLines.id, researchSources.scriptLineId)).where(eq(scriptLines.projectId, projectId)),
    db.select().from(visualRecommendations).where(eq(visualRecommendations.projectId, projectId)),
  ]);

  const allLinks = allAssets.filter((a) => !a.footage_assets.filtered).map((a) => a.footage_assets.sourceUrl);
  const totalVisible = allLinks.length;
  const totalFiltered = allAssets.length - totalVisible;

  return (
    <div className="min-h-screen bg-[#09090b] text-[#d4d4d8]">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#09090b]/95 backdrop-blur-sm border-b border-[#18181b]">
        <div className="max-w-4xl mx-auto px-5 py-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest mb-1">Investigation Report</p>
            <h1 className="text-lg font-semibold text-white">{project.title}</h1>
            <div className="flex gap-4 mt-2 text-xs text-[#52525b]">
              <span><b className="text-[#a1a1aa]">{totalVisible}</b> footage</span>
              <span><b className="text-[#a1a1aa]">{allQuotes.length}</b> quotes</span>
              <span><b className="text-[#a1a1aa]">{allSources.length}</b> articles</span>
              <span className="text-[#27272a]">{totalFiltered} filtered</span>
            </div>
          </div>
          <CopyLinksButton links={allLinks} />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-6 space-y-6">
        {lines.map((line) => {
          const la = allAssets.filter((a) => a.footage_assets.scriptLineId === line.id).map((a) => a.footage_assets);
          const visible = la.filter((a) => !a.filtered);
          const filtered = la.filter((a) => a.filtered);
          const lq = allQuotes.filter((q) => q.footage_quotes.scriptLineId === line.id).map((q) => q.footage_quotes);
          const ls = allSources.filter((s) => s.research_sources.scriptLineId === line.id).map((s) => s.research_sources);
          const lr = allRecs.filter((r) => r.scriptLineId === line.id && !r.dismissed);

          const ytVisible = visible.filter((a) => a.provider === "youtube");
          const xVisible = visible.filter((a) => a.provider === "twitter");
          const otherVisible = visible.filter((a) => a.provider !== "youtube" && a.provider !== "twitter");
          const lineLinks = visible.map((a) => a.sourceUrl);
          const isEmpty = visible.length === 0 && lq.length === 0 && ls.length === 0 && lr.length === 0;

          return (
            <section key={line.id} id={line.lineKey} className="rounded-xl border border-[#18181b] bg-[#0c0c0e] overflow-hidden">
              {/* Line header */}
              <div className="px-5 py-4 bg-[#0f0f12] border-b border-[#18181b]">
                <div className="flex items-center gap-2 mb-1.5 text-[10px]">
                  <span className="font-mono text-[#3f3f46]">{line.lineKey}</span>
                  {line.lineContentCategory && (
                    <span className="px-1.5 py-px rounded bg-[#18181b] text-[#71717a]">{line.lineContentCategory.replace(/_/g, " ")}</span>
                  )}
                  <div className="flex-1" />
                  {lineLinks.length > 0 && <CopyLinksButton links={lineLinks} label={`${lineLinks.length} links`} small />}
                </div>
                <p className="text-[15px] text-[#e4e4e7] leading-relaxed">{line.text}</p>
              </div>

              <div className="px-5 py-4 space-y-5">
                {/* AI Recommendations */}
                {lr.map((r) => (
                  <div key={r.id} className="flex gap-2 p-3 rounded-lg bg-violet-500/5 border border-violet-500/15 text-xs">
                    <span className="text-violet-400 font-medium">AI</span>
                    <span className="text-[#a1a1aa]">{r.reason}</span>
                  </div>
                ))}

                {/* Quotes */}
                {lq.length > 0 && (
                  <div>
                    <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold mb-2">Quotes</p>
                    <div className="space-y-2">
                      {lq.map((q) => {
                        const ts = `${Math.floor(q.startMs / 60000)}:${String(Math.floor((q.startMs % 60000) / 1000)).padStart(2, "0")}`;
                        return (
                          <div key={q.id} className="p-4 rounded-lg bg-[#111114] border-l-2 border-amber-500/40">
                            <p className="text-[15px] text-[#e4e4e7] italic leading-relaxed">&ldquo;{q.quoteText}&rdquo;</p>
                            <div className="flex items-center gap-3 mt-2 text-xs text-[#52525b]">
                              <span className="font-mono text-amber-400/70">[{ts}]</span>
                              {q.speaker && <span className="text-[#a1a1aa]">— {q.speaker}</span>}
                              <span className="ml-auto">{q.relevanceScore}/100</span>
                            </div>
                            {q.context && <p className="text-[11px] text-[#3f3f46] mt-1.5">{q.context}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* YouTube videos — show first 6, collapse rest */}
                {ytVisible.length > 0 && (
                  <div>
                    <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold mb-3">
                      YouTube <span className="text-[#27272a]">({ytVisible.length})</span>
                    </p>
                    <div className={`grid gap-3 ${ytVisible.length === 1 ? "grid-cols-1 max-w-lg" : "grid-cols-1 md:grid-cols-2"}`}>
                      {ytVisible.slice(0, 6).map((a) => {
                        const views = (a.metadataJson as Record<string, unknown> | null)?.viewCount;
                        const dur = a.durationMs ? `${Math.floor(a.durationMs / 60000)}:${String(Math.floor((a.durationMs % 60000) / 1000)).padStart(2, "0")}` : "";
                        return (
                          <div key={a.id} className="rounded-lg border border-[#18181b] bg-[#111114] overflow-hidden">
                            <YouTubeEmbed videoId={a.externalAssetId} title={a.title} />
                            <div className="px-3 py-2.5">
                              <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#d4d4d8] hover:text-white leading-snug line-clamp-2 block">
                                {decode(a.title)}
                              </a>
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-[#3f3f46]">
                                <span className="text-[#52525b]">{a.channelOrContributor}</span>
                                {dur && <span>{dur}</span>}
                                {views != null && <span>{Number(views as number).toLocaleString()} views</span>}
                                <span className="ml-auto font-mono text-[#27272a]">{a.matchScore}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {ytVisible.length > 6 && (
                      <details className="mt-2">
                        <summary className="text-[10px] text-[#3f3f46] cursor-pointer hover:text-[#52525b] py-1">
                          +{ytVisible.length - 6} more YouTube results
                        </summary>
                        <div className={`grid gap-3 mt-2 ${ytVisible.length - 6 === 1 ? "grid-cols-1 max-w-lg" : "grid-cols-1 md:grid-cols-2"}`}>
                          {ytVisible.slice(6).map((a) => {
                            const views = (a.metadataJson as Record<string, unknown> | null)?.viewCount;
                            const dur = a.durationMs ? `${Math.floor(a.durationMs / 60000)}:${String(Math.floor((a.durationMs % 60000) / 1000)).padStart(2, "0")}` : "";
                            return (
                              <div key={a.id} className="rounded-lg border border-[#18181b] bg-[#111114] overflow-hidden">
                                <YouTubeEmbed videoId={a.externalAssetId} title={a.title} />
                                <div className="px-3 py-2.5">
                                  <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#d4d4d8] hover:text-white leading-snug line-clamp-2 block">{decode(a.title)}</a>
                                  <div className="flex items-center gap-2 mt-1 text-[10px] text-[#3f3f46]">
                                    <span className="text-[#52525b]">{a.channelOrContributor}</span>
                                    {dur && <span>{dur}</span>}
                                    {views != null && <span>{Number(views as number).toLocaleString()} views</span>}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {/* Twitter/X posts — show first 5, collapse rest */}
                {xVisible.length > 0 && (
                  <div>
                    <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold mb-3">
                      X / Twitter <span className="text-[#27272a]">({xVisible.length})</span>
                    </p>
                    <div className="space-y-2">
                      {xVisible.slice(0, 5).map((a) => {
                        const meta = a.metadataJson as Record<string, unknown> | null;
                        const views = meta?.viewCount;
                        const likes = meta?.likeCount;
                        return (
                          <a key={a.id} href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="block p-3 rounded-lg bg-[#111114] border border-[#18181b] hover:border-[#27272a] transition-colors">
                            <p className="text-xs text-[#d4d4d8] leading-relaxed">{a.title}</p>
                            <div className="flex items-center gap-3 mt-2 text-[10px] text-[#3f3f46]">
                              <span className="text-sky-400">{a.channelOrContributor}</span>
                              {views != null && <span>{Number(views as number).toLocaleString()} views</span>}
                              {likes != null && Number(likes) > 0 && <span>{Number(likes as number).toLocaleString()} likes</span>}
                              {a.uploadDate && <span>{String(a.uploadDate).slice(0, 10)}</span>}
                              <span className="ml-auto font-mono text-[#27272a]">{a.matchScore}</span>
                            </div>
                          </a>
                        );
                      })}
                    </div>
                    {xVisible.length > 5 && (
                      <details className="mt-2">
                        <summary className="text-[10px] text-[#3f3f46] cursor-pointer hover:text-[#52525b] py-1">
                          +{xVisible.length - 5} more tweets
                        </summary>
                        <div className="space-y-2 mt-2">
                          {xVisible.slice(5).map((a) => {
                            const meta = a.metadataJson as Record<string, unknown> | null;
                            const views = meta?.viewCount;
                            return (
                              <a key={a.id} href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="block p-3 rounded-lg bg-[#111114] border border-[#18181b] hover:border-[#27272a] transition-colors">
                                <p className="text-xs text-[#d4d4d8] leading-relaxed">{a.title}</p>
                                <div className="flex items-center gap-3 mt-2 text-[10px] text-[#3f3f46]">
                                  <span className="text-sky-400">{a.channelOrContributor}</span>
                                  {views != null && <span>{Number(views as number).toLocaleString()} views</span>}
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {/* Other providers */}
                {otherVisible.length > 0 && (
                  <div>
                    <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold mb-2">Other Sources ({otherVisible.length})</p>
                    <div className="space-y-1.5">
                      {otherVisible.map((a) => (
                        <a key={a.id} href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-[#111114] transition-colors text-xs">
                          {a.previewUrl && <img src={a.previewUrl} alt="" className="w-16 h-10 object-cover rounded flex-shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-[#d4d4d8] truncate">{decode(a.title)}</p>
                            <span className={`text-[10px] ${pColor(a.provider)}`}>{a.provider} {a.matchScore}pts</span>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Filtered */}
                {filtered.length > 0 && (
                  <details className="text-[10px] text-[#27272a]">
                    <summary className="cursor-pointer hover:text-[#3f3f46] py-1">{filtered.length} filtered</summary>
                    <div className="mt-1 space-y-0.5 pl-3 border-l border-[#18181b]">
                      {filtered.map((a) => (
                        <a key={a.id} href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="block hover:text-[#3f3f46] truncate">
                          {a.matchScore} [{a.provider}] {decode(a.title)} {a.filterReason && `— ${a.filterReason}`}
                        </a>
                      ))}
                    </div>
                  </details>
                )}

                {/* Articles */}
                {ls.length > 0 && (
                  <details>
                    <summary className="text-[10px] text-[#3f3f46] cursor-pointer hover:text-[#52525b] py-1">{ls.length} articles</summary>
                    <div className="mt-1 space-y-0.5 pl-3 border-l border-[#18181b]">
                      {ls.map((s) => (
                        <a key={s.id} href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-[#27272a] hover:text-[#3f3f46]">
                          <span className="text-[#3f3f46]">[{s.sourceName}]</span> {s.title}
                        </a>
                      ))}
                    </div>
                  </details>
                )}

                {/* Empty */}
                {isEmpty && line.lineContentCategory === "transition" && (
                  <p className="text-[10px] text-[#1e1e22] italic">Transition — no search</p>
                )}
              </div>
            </section>
          );
        })}
      </main>

      <footer className="border-t border-[#18181b] py-4 text-center text-[10px] text-[#1e1e22]">Moon News Studio</footer>
    </div>
  );
}

function decode(t: string) {
  return t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function pColor(p: string) {
  const m: Record<string, string> = { youtube: "text-red-400", twitter: "text-sky-400", internet_archive: "text-amber-400", google_images: "text-blue-400", getty: "text-emerald-400", storyblocks: "text-indigo-400" };
  return m[p] ?? "text-[#3f3f46]";
}
