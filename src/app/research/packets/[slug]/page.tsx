import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Packet = {
  version: string;
  meta: {
    slug: string;
    title: string;
    generatedAt: string;
    stageFallbackReason?: string | null;
  };
  brief: {
    text: string;
  };
  summary: {
    researchSummary: string;
    thesis: string;
    keyClaims: string[];
    riskyClaims: string[];
    whyItMattersNow: string;
    modernDayRelevance: string[];
    tweetWatchlist: string[];
  };
  discovery: {
    articleQueries: string[];
    mediaQueries: string[];
    deepResearch?: {
      processor: string;
      runId: string;
      interactionId?: string | null;
      status?: string | null;
      content: string;
      basisCount?: number | null;
    } | null;
  };
  sourcePools: {
    clips: Array<{
      title: string;
      provider: string;
      sourceUrl: string;
      channelOrContributor?: string | null;
      relevanceScore: number;
    }>;
    transcriptSources: Array<{
      title: string;
      provider: string;
      sourceUrl: string;
      transcriptStatus: "complete" | "failed";
      transcriptSegments: number;
      transcriptError?: string | null;
    }>;
    transcriptQuotes: Array<{
      sourceLabel: string;
      sourceUrl: string;
      quoteText: string;
      speaker?: string | null;
      context?: string | null;
      startMs?: number | null;
      endMs?: number | null;
      relevanceScore: number;
    }>;
    articles: Array<{
      title: string;
      url: string;
      source: string;
      role: string;
      snippet: string;
      publishedAt?: string | null;
      keyPoints?: string[];
      error?: string | null;
    }>;
    socials: Array<{
      title: string;
      url: string;
      snippet: string;
      publishedAt?: string | null;
      relevanceScore: number;
    }>;
  };
  stages: {
    research?: {
      summary?: string;
      thesis?: string;
      keyClaims?: string[];
      riskyClaims?: string[];
      quoteEvidence?: unknown[];
    };
    outline?: {
      sections?: Array<{
        heading: string;
        purpose: string;
        beatGoal: string;
        targetWordCount?: number | null;
        evidenceSlots?: string[];
      }>;
    };
    quoteSelection?: {
      selectedQuotes?: unknown[];
      rejectedQuotes?: unknown[];
    };
    quotePlacement?: {
      placements?: unknown[];
    };
    sectionPlan?: {
      sections?: unknown[];
    };
    whyItMatters?: {
      whyItMattersNow?: string;
      modernDayRelevance?: string[];
      tweetWatchlist?: string[];
    };
  };
  sections: Array<{
    id: string;
    order: number;
    heading: string;
    narrativeRole: string;
    purpose: string;
    beatGoal: string;
    targetWordCount?: number | null;
    whyItMattersNow: string;
    openingMove: string;
    closingMove: string;
    evidenceSlots: string[];
    linkedEvidenceSlots?: Array<{
      label: string;
      sourceType: string;
      sourceTitle: string;
      sourceUrl?: string | null;
      quoteText?: string | null;
      context?: string | null;
      startMs?: number | null;
      endMs?: number | null;
      note?: string | null;
    }>;
    quotes: Array<{
      id: string;
      sourceType: string;
      sourceTitle: string;
      sourceUrl?: string | null;
      quoteText: string;
      speaker?: string | null;
      context?: string | null;
      relevanceScore?: number | null;
      usageRole?: string | null;
      startMs?: number | null;
      endMs?: number | null;
    }>;
    transcriptQuotes: Array<{
      sourceLabel: string;
      sourceUrl: string;
      quoteText: string;
      speaker?: string | null;
      context?: string | null;
      startMs?: number | null;
      endMs?: number | null;
      relevanceScore: number;
    }>;
    clips: Array<{
      title: string;
      provider: string;
      sourceUrl: string;
      channelOrContributor?: string | null;
      relevanceScore: number;
    }>;
    articles: Array<{
      title: string;
      url: string;
      source: string;
      role: string;
      snippet: string;
      publishedAt?: string | null;
      keyPoints?: string[];
    }>;
    socials: Array<{
      title: string;
      url: string;
      snippet: string;
      publishedAt?: string | null;
      relevanceScore: number;
    }>;
  }>;
};

async function loadPacket(slug: string) {
  const filePath = path.resolve(process.cwd(), "research", `research-packet-${slug}.json`);
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Packet;
  } catch {
    notFound();
  }
}

function formatTimestamp(startMs: number | null | undefined) {
  if (typeof startMs !== "number" || startMs < 0) return null;
  const totalSeconds = Math.floor(startMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRange(startMs: number | null | undefined, endMs: number | null | undefined) {
  const start = formatTimestamp(startMs);
  if (!start) return null;
  const end = formatTimestamp(endMs);
  return end && end !== start ? `${start}-${end}` : start;
}

function normalizeExternalUrl(url: string | null | undefined) {
  if (!url) return null;
  let normalized = url.trim();
  if (!normalized) return null;

  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) break;
      normalized = decoded;
    } catch {
      break;
    }
  }

  normalized = normalized.replace(
    /(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[^&?]+)\?t=(\d+)/i,
    "$1&t=$2"
  );

  try {
    const parsed = new URL(normalized);
    if (/youtube\.com$/i.test(parsed.hostname) && parsed.pathname === "/watch") {
      const videoValue = parsed.searchParams.get("v");
      if (videoValue?.includes("?t=")) {
        const [videoId, tValue] = videoValue.split("?t=");
        parsed.searchParams.set("v", videoId);
        if (tValue && !parsed.searchParams.get("t")) {
          parsed.searchParams.set("t", tValue);
        }
      }
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
      <div className="text-3xl font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  eyebrow,
}: {
  title: string;
  children: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
      {eyebrow ? (
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-blue)]">
          {eyebrow}
        </div>
      ) : null}
      <h2 className="text-2xl font-semibold text-[var(--text-primary)]">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LinkCard({
  title,
  url,
  meta,
  body,
}: {
  title: string;
  url: string;
  meta?: string | null;
  body?: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4">
      <a
        href={normalizeExternalUrl(url) ?? url}
        target="_blank"
        rel="noreferrer"
        className="text-base font-semibold text-[var(--text-primary)] underline decoration-[var(--accent-blue)]/30 underline-offset-2 hover:text-[var(--accent-blue)]"
      >
        {title}
      </a>
      {meta ? <div className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">{meta}</div> : null}
      {body ? <div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{body}</div> : null}
    </article>
  );
}

function QuoteCard({
  quote,
}: {
  quote: {
    sourceTitle: string;
    sourceUrl?: string | null;
    quoteText: string;
    speaker?: string | null;
    context?: string | null;
    usageRole?: string | null;
    relevanceScore?: number | null;
    startMs?: number | null;
    endMs?: number | null;
    sourceType?: string | null;
  };
}) {
  const range = formatRange(quote.startMs, quote.endMs);
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-5">
      <div className="mb-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
        <span className="font-semibold text-[var(--text-primary)] normal-case tracking-normal">
          {quote.sourceUrl ? (
            <a
              href={normalizeExternalUrl(quote.sourceUrl) ?? quote.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-[var(--accent-blue)]/30 underline-offset-2 hover:text-[var(--accent-blue)]"
            >
              {quote.sourceTitle}
            </a>
          ) : (
            quote.sourceTitle
          )}
        </span>
        {quote.sourceType ? <span>{quote.sourceType.replace(/_/g, " ")}</span> : null}
        {range ? <span>{range}</span> : null}
        {typeof quote.relevanceScore === "number" ? <span>{Math.round(quote.relevanceScore)}%</span> : null}
      </div>
      <blockquote className="border-l-2 border-[var(--accent-orange)] pl-4 text-[15px] leading-7 text-[var(--text-primary)] whitespace-pre-wrap">
        {quote.quoteText}
      </blockquote>
      {(quote.speaker || quote.context || quote.usageRole) && (
        <div className="mt-4 space-y-1 text-sm leading-6 text-[var(--text-secondary)]">
          {quote.speaker ? <p><span className="font-medium text-[var(--text-muted)]">Speaker:</span> {quote.speaker}</p> : null}
          {quote.context ? <p><span className="font-medium text-[var(--text-muted)]">Context:</span> {quote.context}</p> : null}
          {quote.usageRole ? <p><span className="font-medium text-[var(--text-muted)]">Use:</span> {quote.usageRole}</p> : null}
        </div>
      )}
    </article>
  );
}

export default async function ResearchPacketPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const packet = await loadPacket(slug);

  return (
    <main className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 px-6 py-10 lg:px-10">
        <header className="rounded-[32px] border border-[var(--border)] bg-[linear-gradient(135deg,rgba(18,18,18,0.98),rgba(26,35,50,0.92))] p-8">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
            Research Packet
          </div>
          <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-tight text-[var(--text-primary)]">
            {packet.meta.title}
          </h1>
          <p className="mt-4 max-w-4xl text-lg leading-8 text-[var(--text-secondary)]">
            {packet.summary.thesis}
          </p>
          {packet.meta.stageFallbackReason ? (
            <div className="mt-5 rounded-2xl border border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/10 p-4 text-sm leading-6 text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">Fallback mode:</span> {packet.meta.stageFallbackReason}
            </div>
          ) : null}
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <StatCard label="Sections" value={packet.sections.length} />
          <StatCard label="Source Clips" value={packet.sourcePools.clips.length} />
          <StatCard label="Transcript Quotes" value={packet.sourcePools.transcriptQuotes.length} />
          <StatCard label="Articles" value={packet.sourcePools.articles.length} />
          <StatCard label="Social Leads" value={packet.sourcePools.socials.length} />
          <StatCard label="Transcript Sources" value={packet.sourcePools.transcriptSources.length} />
        </section>

        <section className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
          <Panel title="Brief" eyebrow="Story">
            <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--text-secondary)]">
              {packet.brief.text}
            </p>
          </Panel>
          <Panel title="Why It Matters" eyebrow="Summary">
            <p className="text-[15px] leading-7 text-[var(--text-secondary)]">
              {packet.summary.whyItMattersNow}
            </p>
            {packet.summary.modernDayRelevance.length > 0 ? (
              <div className="mt-4 space-y-3">
                {packet.summary.modernDayRelevance.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 text-sm leading-6 text-[var(--text-secondary)]"
                  >
                    {item}
                  </div>
                ))}
              </div>
            ) : null}
          </Panel>
        </section>

        <section className="grid gap-8 xl:grid-cols-[1fr_1fr]">
          <Panel title="Research Summary" eyebrow="Summary">
            <p className="text-[15px] leading-7 text-[var(--text-secondary)]">
              {packet.summary.researchSummary}
            </p>
            {packet.summary.keyClaims.length > 0 ? (
              <div className="mt-6 space-y-3">
                {packet.summary.keyClaims.map((claim) => (
                  <div
                    key={claim}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 text-sm leading-6 text-[var(--text-secondary)]"
                  >
                    {claim}
                  </div>
                ))}
              </div>
            ) : null}
          </Panel>
          <Panel title="Parallel Deep Research Memo" eyebrow="Discovery">
            {packet.discovery.deepResearch ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  <span>Processor: {packet.discovery.deepResearch.processor}</span>
                  <span>Status: {packet.discovery.deepResearch.status ?? "unknown"}</span>
                  {typeof packet.discovery.deepResearch.basisCount === "number" ? (
                    <span>Basis: {packet.discovery.deepResearch.basisCount}</span>
                  ) : null}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-5 text-sm leading-6 text-[var(--text-secondary)]">
                  {packet.discovery.deepResearch.content}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">No deep research memo saved.</p>
            )}
          </Panel>
        </section>

        <Panel title="Sections" eyebrow="Writer Packet">
          <div className="space-y-8">
            {packet.sections.map((section) => (
              <article
                key={section.id}
                className="rounded-[28px] border border-[var(--border)] bg-[var(--bg-tertiary)] p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-blue)]">
                      Section {section.order}
                    </div>
                    <h3 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">
                      {section.heading}
                    </h3>
                    <p className="mt-3 max-w-4xl text-sm leading-7 text-[var(--text-secondary)]">
                      {section.narrativeRole}
                    </p>
                  </div>
                  {section.targetWordCount ? (
                    <div className="rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      {section.targetWordCount} words
                    </div>
                  ) : null}
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-3">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-blue)]">
                      Purpose
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{section.purpose}</p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-blue)]">
                      Opening Move
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{section.openingMove}</p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-blue)]">
                      Closing Move
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{section.closingMove}</p>
                  </div>
                </div>

                {(section.linkedEvidenceSlots?.length || section.evidenceSlots.length) > 0 ? (
                  <div className="mt-6">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-blue)]">
                      Evidence Slots
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(section.linkedEvidenceSlots?.length
                        ? section.linkedEvidenceSlots.map((slot) => ({
                            key: `${slot.label}-${slot.sourceUrl ?? slot.sourceTitle}`,
                            label: slot.label,
                            sourceTitle: slot.sourceTitle,
                            sourceUrl: slot.sourceUrl ?? null,
                            context: slot.context ?? null,
                            note: slot.note ?? null,
                            range: formatRange(slot.startMs, slot.endMs),
                          }))
                        : section.evidenceSlots.map((slot) => ({
                            key: slot,
                            label: slot,
                            sourceTitle: null,
                            sourceUrl: null,
                            context: null,
                            note: null,
                            range: null,
                          }))
                      ).map((slot) => (
                        <article
                          key={slot.key}
                          className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"
                        >
                          <div className="text-sm leading-6 text-[var(--text-secondary)]">
                            {slot.label}
                          </div>
                          {slot.sourceTitle ? (
                            <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
                              {slot.sourceUrl ? (
                                <a
                                  href={normalizeExternalUrl(slot.sourceUrl) ?? slot.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-semibold normal-case tracking-normal text-[var(--text-primary)] underline decoration-[var(--accent-blue)]/30 underline-offset-2 hover:text-[var(--accent-blue)]"
                                >
                                  {slot.sourceTitle}
                                </a>
                              ) : (
                                <span className="font-semibold normal-case tracking-normal text-[var(--text-primary)]">
                                  {slot.sourceTitle}
                                </span>
                              )}
                              {slot.range ? <span>{slot.range}</span> : null}
                            </div>
                          ) : null}
                          {slot.context || slot.note ? (
                            <div className="mt-3 space-y-1 text-sm leading-6 text-[var(--text-secondary)]">
                              {slot.context ? <p>{slot.context}</p> : null}
                              {slot.note ? <p className="text-[var(--text-muted)]">{slot.note}</p> : null}
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}

                {section.quotes.length > 0 ? (
                  <div className="mt-6">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-blue)]">
                      Selected Quotes
                    </div>
                    <div className="grid gap-4 xl:grid-cols-2">
                      {section.quotes.map((quote) => (
                        <QuoteCard key={`${section.id}-${quote.id}`} quote={quote} />
                      ))}
                    </div>
                  </div>
                ) : null}

                {section.transcriptQuotes.length > 0 ? (
                  <div className="mt-6">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-blue)]">
                      Transcript Quote Bank
                    </div>
                    <div className="grid gap-4 xl:grid-cols-2">
                      {section.transcriptQuotes.map((quote) => (
                        <QuoteCard
                          key={`${section.id}-${quote.sourceUrl}-${quote.startMs ?? 0}`}
                          quote={{
                            sourceTitle: quote.sourceLabel,
                            sourceUrl: quote.sourceUrl,
                            quoteText: quote.quoteText,
                            speaker: quote.speaker,
                            context: quote.context,
                            relevanceScore: quote.relevanceScore,
                            startMs: quote.startMs,
                            endMs: quote.endMs,
                            sourceType: "transcript",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-6 grid gap-6 xl:grid-cols-3">
                  <div>
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-blue)]">
                      Key Clips To Watch
                    </div>
                    <div className="space-y-3">
                      {section.clips.map((clip) => (
                        <LinkCard
                          key={clip.sourceUrl}
                          title={clip.title}
                          url={clip.sourceUrl}
                          meta={[clip.provider, clip.channelOrContributor, `${Math.round(clip.relevanceScore)}%`]
                            .filter(Boolean)
                            .join(" · ")}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-blue)]">
                      Related Articles
                    </div>
                    <div className="space-y-3">
                      {section.articles.map((article) => (
                        <LinkCard
                          key={article.url}
                          title={article.title}
                          url={article.url}
                          meta={[article.source, article.role, article.publishedAt ?? null]
                            .filter(Boolean)
                            .join(" · ")}
                          body={
                            <>
                              <p>{article.snippet}</p>
                              {article.keyPoints?.length ? (
                                <div className="mt-3 space-y-2">
                                  {article.keyPoints.map((point) => (
                                    <div
                                      key={point}
                                      className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-xs leading-5 text-[var(--text-secondary)]"
                                    >
                                      {point}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </>
                          }
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-blue)]">
                      Social Leads
                    </div>
                    <div className="space-y-3">
                      {section.socials.map((post) => (
                        <LinkCard
                          key={post.url}
                          title={post.title}
                          url={post.url}
                          meta={[post.publishedAt ?? null, `${Math.round(post.relevanceScore)}%`]
                            .filter(Boolean)
                            .join(" · ")}
                          body={<p>{post.snippet}</p>}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      <style>{`
        :root {
          --bg-primary: #0b0f14;
          --bg-secondary: #121821;
          --bg-tertiary: #18212d;
          --border: rgba(180, 196, 214, 0.14);
          --text-primary: #f5f7fb;
          --text-secondary: #c4cfdb;
          --text-muted: #8d9aab;
          --accent-blue: #6db7ff;
          --accent-orange: #f8a15b;
        }
        body {
          margin: 0;
          background: radial-gradient(circle at top, rgba(109, 183, 255, 0.08), transparent 30%), var(--bg-primary);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        * {
          box-sizing: border-box;
        }
        a {
          color: inherit;
        }
      `}</style>
    </main>
  );
}
