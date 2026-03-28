import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type TranscriptQuote = {
  sourceLabel: string;
  sourceUrl: string;
  quoteText: string;
  speaker?: string | null;
  context?: string | null;
  startMs?: number | null;
  endMs?: number | null;
  relevanceScore: number;
};

type SocialPost = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string | null;
  relevanceScore: number;
};

type ClipCard = {
  title: string;
  provider: string;
  sourceUrl: string;
  channelOrContributor?: string | null;
  relevanceScore: number;
};

type OutlineSection = {
  heading: string;
  purpose: string;
  beatGoal: string;
  targetWordCount: number;
  evidenceSlots: string[];
};

type SectionPackage = {
  sectionHeading: string;
  narrativeRole: string;
  purpose: string;
  beatGoal: string;
  targetWordCount?: number | null;
  evidenceSlots: string[];
  whyItMattersNow: string;
  openingMove: string;
  closingMove: string;
  exactQuotes: Array<{
    quoteId: string;
    sourceType: "clip_transcript" | "research_text";
    sourceTitle: string;
    sourceUrl?: string | null;
    quoteText: string;
    speaker?: string | null;
    context?: string | null;
    relevanceScore?: number | null;
    usageRole: string;
    startMs?: number | null;
    endMs?: number | null;
  }>;
  transcriptQuotes: TranscriptQuote[];
  keyClipsToWatch: ClipCard[];
  relatedArticles: Array<{
    title: string;
    url: string;
    source: string;
    role: string;
    snippet: string;
    publishedAt?: string | null;
    keyPoints?: string[];
  }>;
  relatedSocialPosts: SocialPost[];
};

type Report = {
  title: string;
  generatedAt: string;
  briefText?: string | null;
  stageFallbackReason?: string | null;
  deepResearch?: {
    processor: string;
    runId: string;
    interactionId?: string | null;
    status?: string | null;
    content: string;
    basisCount?: number | null;
  } | null;
  socialPosts?: SocialPost[];
  discoveredClips?: ClipCard[];
  transcriptQuotes?: TranscriptQuote[];
  transcriptSources?: Array<{
    title: string;
    provider: string;
    sourceUrl: string;
    transcriptStatus: "complete" | "failed";
    transcriptSegments: number;
    transcriptError?: string | null;
  }>;
  researchStage?: {
    summary?: string;
    thesis?: string;
    keyClaims?: string[];
    riskyClaims?: string[];
  };
  outlineStage?: {
    sections?: OutlineSection[];
  };
  whyItMattersStage?: {
    whyItMattersNow?: string;
    modernDayRelevance?: string[];
    tweetWatchlist?: string[];
  };
  sectionClipPackages?: SectionPackage[];
};

async function loadReport() {
  const filePath = path.resolve(process.cwd(), "research", "direct-outline-norm-macdonald.json");
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as Report;
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
  return end && end !== start ? `${start}\u2013${end}` : start;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 transition-colors hover:border-[var(--border-light)]">
      <div className="text-3xl font-bold text-[var(--text-primary)]">{value}</div>
      <div className="mt-2 text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </div>
    </div>
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
    startMs?: number | null;
    endMs?: number | null;
    sourceType?: string | null;
    relevanceScore?: number | null;
  };
}) {
  const range = formatRange(quote.startMs, quote.endMs);
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
        <span className="font-semibold text-[var(--text-primary)]">
          {quote.sourceUrl ? (
            <a
              href={quote.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-[var(--accent-blue)]/30 underline-offset-2 hover:text-[var(--accent-blue)] transition-colors"
            >
              {quote.sourceTitle}
            </a>
          ) : (
            quote.sourceTitle
          )}
        </span>
        {quote.sourceType && (
          <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs">
            {quote.sourceType.replace(/_/g, " ")}
          </span>
        )}
        {range && (
          <span className="rounded-full bg-[var(--accent-blue)]/10 px-2 py-0.5 text-xs font-mono text-[var(--accent-blue)]">
            {range}
          </span>
        )}
        {typeof quote.relevanceScore === "number" && (
          <span className="rounded-full bg-[var(--accent-green)]/10 px-2 py-0.5 text-xs font-mono text-[var(--accent-green)]">
            {Math.round(quote.relevanceScore)}%
          </span>
        )}
      </div>
      <blockquote className="m-0 border-l-2 border-[var(--accent-purple)] pl-4 text-base leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap italic">
        {quote.quoteText}
      </blockquote>
      <div className="mt-3 space-y-1 text-sm text-[var(--text-secondary)]">
        {quote.speaker && (
          <p className="m-0">
            <span className="font-medium text-[var(--text-muted)]">Speaker:</span> {quote.speaker}
          </p>
        )}
        {quote.context && (
          <p className="m-0">
            <span className="font-medium text-[var(--text-muted)]">Context:</span> {quote.context}
          </p>
        )}
        {quote.usageRole && (
          <p className="m-0">
            <span className="font-medium text-[var(--text-muted)]">Use:</span> {quote.usageRole}
          </p>
        )}
      </div>
    </article>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-blue)]">
      {children}
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 ${className}`}
    >
      {children}
    </section>
  );
}

export default async function NormMacdonaldReviewPage() {
  const report = await loadReport();
  const sections = report.sectionClipPackages ?? [];
  const outlineSections = report.outlineStage?.sections ?? [];
  const transcriptSources = report.transcriptSources ?? [];
  const socialPosts = report.socialPosts ?? [];
  const discoveredClips = report.discoveredClips ?? [];
  const completedTranscriptSources = transcriptSources.filter(
    (source) => source.transcriptStatus === "complete"
  ).length;

  return (
    <main className="min-h-screen bg-[var(--bg-primary)] pb-20 pt-8">
      <div className="mx-auto max-w-[1460px] space-y-6 px-4 sm:px-6 lg:px-8">
        {/* Hero / Header */}
        <Card className="!p-8 sm:!p-10">
          <SectionLabel>Moon Internal</SectionLabel>
          <h1 className="mt-1 text-4xl font-bold leading-tight tracking-tight text-[var(--text-primary)] sm:text-5xl lg:text-6xl">
            Norm Macdonald Research Book
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[var(--text-secondary)]">
            Full planning packet with the editorial brief, modern-day relevance, Parallel deep
            research memo, section-by-section plan, transcript-backed clip passages, related
            articles, and social leads.
          </p>
          {report.briefText && (
            <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--accent-orange)]">
                Editorial Brief
              </div>
              <p className="m-0 leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
                {report.briefText}
              </p>
            </div>
          )}
        </Card>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Deep Research" value={report.deepResearch?.processor ?? "missing"} />
          <StatCard label="Outline Sections" value={outlineSections.length} />
          <StatCard label="Discovered Clips" value={discoveredClips.length} />
          <StatCard label="Transcript Sources" value={transcriptSources.length} />
          <StatCard label="Completed Transcripts" value={completedTranscriptSources} />
          <StatCard label="Social Leads" value={socialPosts.length} />
        </div>

        {/* Fallback Alert */}
        {report.stageFallbackReason && (
          <div className="rounded-xl border border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/5 p-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--accent-orange)]">
              Fallback Mode
            </div>
            <p className="m-0 leading-relaxed text-[var(--text-secondary)]">
              Claude stage generation failed on this run, so the page is showing the collected
              research with a deterministic fallback plan. Reason: {report.stageFallbackReason}
            </p>
          </div>
        )}

        {/* Core Argument + Why It Matters */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionLabel>Core Argument</SectionLabel>
            <h2 className="mb-3 text-2xl font-bold text-[var(--text-primary)]">Thesis</h2>
            <p className="mb-4 text-lg leading-relaxed text-[var(--text-primary)]">
              {report.researchStage?.thesis}
            </p>
            <p className="m-0 leading-relaxed text-[var(--text-secondary)]">
              {report.researchStage?.summary}
            </p>
          </Card>

          <Card>
            <SectionLabel>Why It Matters</SectionLabel>
            <p className="mb-4 leading-relaxed text-[var(--text-primary)]">
              {report.whyItMattersStage?.whyItMattersNow ?? "No current relevance memo saved."}
            </p>
            {(report.whyItMattersStage?.modernDayRelevance ?? []).length > 0 && (
              <ul className="m-0 space-y-2 pl-5 text-[var(--text-secondary)]">
                {(report.whyItMattersStage?.modernDayRelevance ?? []).map((item) => (
                  <li key={item} className="leading-relaxed">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Deep Research Memo */}
        <Card>
          <SectionLabel>Parallel Deep Research Memo</SectionLabel>
          {report.deepResearch ? (
            <>
              <div className="mb-4 flex flex-wrap gap-2 text-sm text-[var(--text-muted)]">
                <span className="rounded-full bg-[var(--bg-tertiary)] px-3 py-1 text-xs font-medium">
                  {report.deepResearch.processor}
                </span>
                <span className="rounded-full bg-[var(--bg-tertiary)] px-3 py-1 font-mono text-xs">
                  {report.deepResearch.runId}
                </span>
                {report.deepResearch.status && (
                  <span className="rounded-full bg-[var(--accent-green)]/10 px-3 py-1 text-xs text-[var(--accent-green)]">
                    {report.deepResearch.status}
                  </span>
                )}
              </div>
              <div className="max-h-[600px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-5">
                <pre className="m-0 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-[var(--text-secondary)]">
                  {report.deepResearch.content}
                </pre>
              </div>
            </>
          ) : (
            <p className="m-0 leading-relaxed text-[var(--text-secondary)]">
              No deep research memo saved. The report needs a rerun with the Task API memo
              succeeding.
            </p>
          )}
        </Card>

        {/* Section Navigation */}
        <Card>
          <SectionLabel>Section Navigation</SectionLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((section, index) => (
              <a
                key={section.sectionHeading}
                href={`#section-${index + 1}`}
                className="group rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 no-underline transition-all hover:border-[var(--accent-blue)]/40 hover:bg-[var(--bg-hover)]"
              >
                <div className="mb-1 text-xs font-medium uppercase tracking-widest text-[var(--text-muted)] group-hover:text-[var(--accent-blue)]">
                  Section {index + 1}
                </div>
                <div className="font-semibold text-[var(--text-primary)]">
                  {section.sectionHeading}
                </div>
              </a>
            ))}
          </div>
        </Card>

        {/* Section Packages */}
        {sections.map((section, index) => {
          const seenTranscriptKeys = new Set(
            section.exactQuotes.map(
              (quote) => `${quote.sourceTitle}|${quote.startMs ?? ""}|${quote.quoteText}`
            )
          );
          const additionalTranscriptQuotes = section.transcriptQuotes.filter(
            (quote) =>
              !seenTranscriptKeys.has(
                `${quote.sourceLabel}|${quote.startMs ?? ""}|${quote.quoteText}`
              )
          );

          return (
            <section
              id={`section-${index + 1}`}
              key={section.sectionHeading}
              className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6"
            >
              {/* Section header */}
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <SectionLabel>Section {index + 1}</SectionLabel>
                  <h2 className="mb-3 text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">
                    {section.sectionHeading}
                  </h2>
                  <div className="space-y-2 text-[var(--text-secondary)] leading-relaxed">
                    <p className="m-0">
                      <span className="font-medium text-[var(--text-primary)]">Purpose:</span>{" "}
                      {section.purpose || "Not set"}
                    </p>
                    <p className="m-0">
                      <span className="font-medium text-[var(--text-primary)]">Beat goal:</span>{" "}
                      {section.beatGoal || "Not set"}
                    </p>
                    <p className="m-0">
                      <span className="font-medium text-[var(--text-primary)]">
                        Why this section matters now:
                      </span>{" "}
                      {section.whyItMattersNow}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-5">
                  <div className="space-y-3 text-sm text-[var(--text-secondary)]">
                    <div>
                      <span className="font-medium text-[var(--text-muted)]">Narrative role:</span>{" "}
                      {section.narrativeRole}
                    </div>
                    <div>
                      <span className="font-medium text-[var(--text-muted)]">Opening move:</span>{" "}
                      {section.openingMove}
                    </div>
                    <div>
                      <span className="font-medium text-[var(--text-muted)]">Closing move:</span>{" "}
                      {section.closingMove}
                    </div>
                    <div>
                      <span className="font-medium text-[var(--text-muted)]">Target words:</span>{" "}
                      {section.targetWordCount ?? "n/a"}
                    </div>
                    {section.evidenceSlots.length > 0 && (
                      <div>
                        <span className="font-medium text-[var(--text-muted)]">
                          Evidence slots:
                        </span>
                        <ul className="mt-2 space-y-1 pl-4">
                          {section.evidenceSlots.map((slot) => (
                            <li key={slot} className="leading-snug">
                              {slot}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Exact Quotes */}
              <div>
                <h3 className="mb-3 text-xl font-bold text-[var(--text-primary)]">
                  Exact Quotes To Use
                </h3>
                {section.exactQuotes.length > 0 ? (
                  <div className="space-y-3">
                    {section.exactQuotes.map((quote) => (
                      <QuoteCard
                        key={`${section.sectionHeading}-${quote.quoteId}`}
                        quote={{
                          sourceTitle: quote.sourceTitle,
                          sourceUrl: quote.sourceUrl,
                          quoteText: quote.quoteText,
                          speaker: quote.speaker,
                          context: quote.context,
                          usageRole: quote.usageRole,
                          startMs: quote.startMs,
                          endMs: quote.endMs,
                          sourceType: quote.sourceType,
                          relevanceScore: quote.relevanceScore,
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="m-0 text-[var(--text-muted)]">
                    No section-specific selected quotes were saved.
                  </p>
                )}
              </div>

              {/* Additional Transcript Passages */}
              <div>
                <h3 className="mb-3 text-xl font-bold text-[var(--text-primary)]">
                  Additional Transcript Passages
                </h3>
                {additionalTranscriptQuotes.length > 0 ? (
                  <div className="space-y-3">
                    {additionalTranscriptQuotes.map((quote) => (
                      <QuoteCard
                        key={`${section.sectionHeading}-${quote.sourceUrl}-${quote.startMs ?? "na"}`}
                        quote={{
                          sourceTitle: quote.sourceLabel,
                          sourceUrl: quote.sourceUrl,
                          quoteText: quote.quoteText,
                          speaker: quote.speaker,
                          context: quote.context,
                          startMs: quote.startMs,
                          endMs: quote.endMs,
                          sourceType: "clip_transcript",
                          relevanceScore: quote.relevanceScore,
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="m-0 text-[var(--text-muted)]">
                    No extra transcript-backed passages matched this section yet.
                  </p>
                )}
              </div>

              {/* Bottom grid: Clips, Articles, Social */}
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-5">
                  <h3 className="mb-3 text-lg font-bold text-[var(--text-primary)]">
                    Key Clips To Watch
                  </h3>
                  {section.keyClipsToWatch.length > 0 ? (
                    <ul className="m-0 space-y-3 pl-0 list-none">
                      {section.keyClipsToWatch.map((clip) => (
                        <li key={clip.sourceUrl}>
                          <a
                            href={clip.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-[var(--accent-blue)] underline decoration-[var(--accent-blue)]/20 underline-offset-2 hover:decoration-[var(--accent-blue)] transition-colors"
                          >
                            {clip.title}
                          </a>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                            {clip.provider}
                            {clip.channelOrContributor
                              ? ` \u00B7 ${clip.channelOrContributor}`
                              : ""}
                            {` \u00B7 ${Math.round(clip.relevanceScore)}%`}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-sm text-[var(--text-muted)]">
                      No clip leads assigned to this section yet.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-5">
                  <h3 className="mb-3 text-lg font-bold text-[var(--text-primary)]">
                    Related Articles
                  </h3>
                  {section.relatedArticles.length > 0 ? (
                    <ul className="m-0 space-y-3 pl-0 list-none">
                      {section.relatedArticles.map((article) => (
                        <li key={article.url}>
                          <a
                            href={article.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-[var(--accent-blue)] underline decoration-[var(--accent-blue)]/20 underline-offset-2 hover:decoration-[var(--accent-blue)] transition-colors"
                          >
                            {article.title}
                          </a>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                            {article.role.replace(/_/g, " ")} \u00B7 {article.source}
                            {article.publishedAt ? ` \u00B7 ${article.publishedAt}` : ""}
                          </div>
                          <div className="mt-1 text-sm leading-snug text-[var(--text-secondary)]">
                            {article.snippet}
                          </div>
                          {article.keyPoints && article.keyPoints.length > 0 ? (
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
                              {article.keyPoints.map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-sm text-[var(--text-muted)]">
                      No related article links assigned to this section yet.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-5">
                  <h3 className="mb-3 text-lg font-bold text-[var(--text-primary)]">
                    Tweets / Social Leads
                  </h3>
                  {section.relatedSocialPosts.length > 0 ? (
                    <ul className="m-0 space-y-3 pl-0 list-none">
                      {section.relatedSocialPosts.map((post) => (
                        <li key={post.url}>
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-[var(--accent-blue)] underline decoration-[var(--accent-blue)]/20 underline-offset-2 hover:decoration-[var(--accent-blue)] transition-colors"
                          >
                            {post.title}
                          </a>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                            {post.publishedAt ?? "date unknown"} \u00B7{" "}
                            {Math.round(post.relevanceScore)}%
                          </div>
                          <div className="mt-1 text-sm leading-snug text-[var(--text-secondary)]">
                            {post.snippet}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-sm text-[var(--text-muted)]">
                      No verified social links assigned to this section yet.
                    </p>
                  )}
                </div>
              </div>
            </section>
          );
        })}

        {/* Transcript Source Status */}
        <Card>
          <h2 className="mb-4 text-xl font-bold text-[var(--text-primary)]">
            Transcript Source Status
          </h2>
          <div className="space-y-3">
            {transcriptSources.map((source) => (
              <div
                key={`${source.sourceUrl}-${source.title}`}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4"
              >
                <div className="mb-1 font-semibold">
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent-blue)] underline decoration-[var(--accent-blue)]/20 underline-offset-2 hover:decoration-[var(--accent-blue)] transition-colors"
                  >
                    {source.title}
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5">
                    {source.provider}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      source.transcriptStatus === "complete"
                        ? "bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
                        : "bg-[var(--accent-red)]/10 text-[var(--accent-red)]"
                    }`}
                  >
                    {source.transcriptStatus}
                  </span>
                  <span>{source.transcriptSegments} segments</span>
                </div>
                {source.transcriptError && (
                  <div className="mt-2 text-sm text-[var(--accent-red)]/80">
                    {source.transcriptError}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </main>
  );
}
