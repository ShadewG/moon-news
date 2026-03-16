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
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <p className="text-[var(--text-muted)]">Project not found</p>
      </div>
    );
  }

  const lines = await db
    .select()
    .from(scriptLines)
    .where(eq(scriptLines.projectId, projectId))
    .orderBy(scriptLines.lineIndex);

  // Fetch all data in parallel
  const [allAssets, allQuotes, allSources, allRecs] = await Promise.all([
    db.select().from(footageAssets)
      .innerJoin(
        scriptLines,
        eq(scriptLines.id, footageAssets.scriptLineId)
      )
      .where(eq(scriptLines.projectId, projectId))
      .orderBy(desc(footageAssets.matchScore)),
    db.select().from(footageQuotes)
      .innerJoin(scriptLines, eq(scriptLines.id, footageQuotes.scriptLineId))
      .where(eq(scriptLines.projectId, projectId))
      .orderBy(desc(footageQuotes.relevanceScore)),
    db.select().from(researchSources)
      .innerJoin(scriptLines, eq(scriptLines.id, researchSources.scriptLineId))
      .where(eq(scriptLines.projectId, projectId)),
    db.select().from(visualRecommendations)
      .where(eq(visualRecommendations.projectId, projectId)),
  ]);

  const totalVisible = allAssets.filter(
    (a) => !a.footage_assets.filtered
  ).length;
  const totalFiltered = allAssets.length - totalVisible;

  const now = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-[#e4e4e7]">
      {/* Header */}
      <header className="border-b border-[#27272a] bg-[#0f0f11]">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-xs text-[#71717a] mb-3">
            <span>Moon News Studio</span>
            <span>/</span>
            <span>Investigation Report</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{project.title}</h1>
          <p className="text-sm text-[#a1a1aa] mt-2">
            Generated {now}
          </p>
          <div className="flex gap-6 mt-4 text-sm">
            <Stat label="Lines" value={lines.length} />
            <Stat label="Footage" value={totalVisible} />
            <Stat label="Filtered" value={totalFiltered} />
            <Stat label="Quotes" value={allQuotes.length} />
            <Stat label="Articles" value={allSources.length} />
            <Stat label="AI Recs" value={allRecs.length} />
          </div>
        </div>
      </header>

      {/* Lines */}
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-10">
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

          return (
            <section
              key={line.id}
              id={line.lineKey}
              className="border border-[#27272a] rounded-xl bg-[#0f0f11] overflow-hidden"
            >
              {/* Line header */}
              <div className="px-6 py-4 border-b border-[#27272a] bg-[#141416]">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-mono text-[#71717a]">
                    {line.lineKey}
                  </span>
                  {line.lineContentCategory && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#27272a] text-[#a1a1aa]">
                      {line.lineContentCategory.replace(/_/g, " ")}
                    </span>
                  )}
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#27272a] text-[#71717a]">
                    {line.lineType}
                  </span>
                  <div className="flex-1" />
                  <div className="flex gap-1.5">
                    {Object.entries(byProvider).map(([p, c]) => (
                      <span
                        key={p}
                        className={`text-[10px] px-1.5 py-0.5 rounded ${providerStyle(p)}`}
                      >
                        {p === "internet_archive" ? "IA" : p === "google_images" ? "GI" : p}: {c}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="text-sm text-[#e4e4e7] leading-relaxed">
                  {line.text}
                </p>
              </div>

              {/* Content */}
              <div className="px-6 py-4 space-y-4">
                {/* Recommendations */}
                {lineRecs.length > 0 && (
                  <div className="space-y-2">
                    {lineRecs.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-start gap-2 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20"
                      >
                        <span className="text-purple-400 text-xs mt-0.5">AI</span>
                        <div>
                          <p className="text-xs text-[#e4e4e7]">
                            Recommend {r.recommendationType.replace(/_/g, " ")}
                          </p>
                          <p className="text-[11px] text-[#71717a]">{r.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quotes */}
                {lineQuotes.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-[#a1a1aa] mb-2 uppercase tracking-wider">
                      Extracted Quotes
                    </h4>
                    <div className="space-y-2">
                      {lineQuotes.map((q) => {
                        const m = Math.floor(q.startMs / 60000);
                        const s = Math.floor((q.startMs % 60000) / 1000);
                        return (
                          <div
                            key={q.id}
                            className="p-3 rounded-lg bg-[#1a1a1e] border border-[#27272a]"
                          >
                            <p className="text-sm text-[#e4e4e7] italic">
                              &ldquo;{q.quoteText}&rdquo;
                            </p>
                            <div className="flex items-center gap-3 mt-2 text-[11px] text-[#71717a]">
                              <span className="font-mono">
                                [{m}:{String(s).padStart(2, "0")}]
                              </span>
                              {q.speaker && (
                                <span className="text-[#a1a1aa]">
                                  — {q.speaker}
                                </span>
                              )}
                              <span>{q.relevanceScore}/100 relevance</span>
                            </div>
                            {q.context && (
                              <p className="text-[11px] text-[#52525b] mt-1">
                                {q.context}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Footage */}
                {visible.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-[#a1a1aa] mb-2 uppercase tracking-wider">
                      Footage ({visible.length})
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {visible.slice(0, 8).map((a) => {
                        const views = (
                          a.metadataJson as Record<string, unknown> | null
                        )?.viewCount;
                        return (
                          <a
                            key={a.id}
                            href={a.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex gap-3 p-3 rounded-lg bg-[#1a1a1e] border border-[#27272a] hover:border-[#3f3f46] transition-colors group"
                          >
                            {a.previewUrl && (
                              <img
                                src={a.previewUrl}
                                alt=""
                                className="w-24 h-16 object-cover rounded flex-shrink-0"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-[#e4e4e7] line-clamp-2 group-hover:text-white">
                                {a.title}
                              </p>
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-[#71717a]">
                                <span className={providerStyle(a.provider)}>
                                  {a.provider}
                                </span>
                                <span>{a.matchScore}pts</span>
                                {a.channelOrContributor && (
                                  <span className="truncate">
                                    {a.channelOrContributor}
                                  </span>
                                )}
                                {views != null && (
                                  <span>
                                    {Number(views as number).toLocaleString()} views
                                  </span>
                                )}
                              </div>
                            </div>
                          </a>
                        );
                      })}
                    </div>
                    {visible.length > 8 && (
                      <p className="text-[11px] text-[#52525b] mt-2">
                        +{visible.length - 8} more results
                      </p>
                    )}
                  </div>
                )}

                {/* Filtered */}
                {filtered.length > 0 && (
                  <details className="text-[11px] text-[#52525b]">
                    <summary className="cursor-pointer hover:text-[#71717a]">
                      {filtered.length} filtered results (lower relevance)
                    </summary>
                    <div className="mt-2 space-y-1 pl-4">
                      {filtered.map((a) => (
                        <div key={a.id} className="flex gap-2">
                          <span className="text-[#3f3f46]">{a.matchScore}pts</span>
                          <a
                            href={a.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-[#71717a] truncate"
                          >
                            [{a.provider}] {a.title}
                          </a>
                          {a.filterReason && (
                            <span className="text-[#3f3f46] flex-shrink-0">
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
                    <summary className="text-xs text-[#71717a] cursor-pointer hover:text-[#a1a1aa]">
                      {lineSources.length} article sources
                    </summary>
                    <div className="mt-2 space-y-1 pl-4">
                      {lineSources.map((s) => (
                        <a
                          key={s.id}
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-[11px] text-[#52525b] hover:text-[#71717a] truncate"
                        >
                          [{s.sourceName}] {s.title}
                        </a>
                      ))}
                    </div>
                  </details>
                )}

                {/* Empty state */}
                {visible.length === 0 &&
                  lineQuotes.length === 0 &&
                  lineSources.length === 0 &&
                  lineRecs.length === 0 &&
                  line.lineContentCategory !== "transition" && (
                    <p className="text-xs text-[#3f3f46] italic">
                      No results yet — run investigation for this line
                    </p>
                  )}
                {line.lineContentCategory === "transition" &&
                  visible.length === 0 && (
                    <p className="text-xs text-[#3f3f46] italic">
                      Transition line — no visual search needed
                    </p>
                  )}
              </div>
            </section>
          );
        })}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#27272a] py-6 text-center text-xs text-[#3f3f46]">
        Generated by Moon News Studio
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="text-white font-semibold">{value}</span>{" "}
      <span className="text-[#71717a]">{label}</span>
    </div>
  );
}

function providerStyle(provider: string): string {
  const styles: Record<string, string> = {
    youtube: "text-red-400",
    twitter: "text-sky-400",
    internet_archive: "text-amber-400",
    google_images: "text-blue-400",
    getty: "text-emerald-400",
    storyblocks: "text-indigo-400",
    parallel: "text-[#71717a]",
  };
  return styles[provider] ?? "text-[#71717a]";
}
