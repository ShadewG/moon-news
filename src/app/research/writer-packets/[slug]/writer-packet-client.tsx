"use client";

import { useState } from "react";

type WriterPack = {
  version: string;
  meta: { slug: string; title: string; generatedAt: string };
  summary: {
    researchSummary: string; thesis: string; storyPoints: string[];
    whyItMattersNow: string; totalSections: number; clipsWithTranscript: number;
    clipsWithTalkingPoints: number; totalTalkingPoints: number;
    missingTranscriptCount: number; unsupportedSourceCount: number;
  };
  topSummary: { shortSummary: string; storyPoints: string[] };
  insaneClips: Array<{
    title: string; sourceUrl: string; provider: string;
    channelOrContributor: string | null; transcriptStatus: string;
    scanStatus: string; talkingPointCount: number; whyUse: string | null;
    visualUrl?: string | null; visualKind?: string | null;
  }>;
  importantQuotes: Array<{
    sourceTitle: string; sourceUrl: string | null; speaker: string | null;
    quoteText: string; context: string | null; startMs: number | null;
    endMs: number | null; provenance: string; sectionHeading: string | null;
    visualUrl?: string | null; visualKind?: string | null;
  }>;
  tiktokClips?: Array<{
    title: string; sourceUrl: string; provider: string;
    channelOrContributor: string | null; transcriptSegments: number;
    talkingPointCount: number; whyUse: string | null; primaryQuote: string | null;
    discoveryQuery: string; visualUrl?: string | null; visualKind?: string | null;
  }>;
  audienceReaction: Array<{
    title: string; url: string; snippet: string; publishedAt?: string | null;
    relevanceScore: number; visualUrl?: string | null; visualKind?: string | null;
  }>;
  articleReceipts: Array<{
    title: string; url: string; source: string; role: string;
    snippet: string; publishedAt?: string | null; keyPoints?: string[];
  }>;
  queues: {
    missingTranscriptQueue: Array<{ title: string; provider: string; sourceUrl: string; channelOrContributor: string | null; reason: string }>;
    unsupportedSourceQueue: Array<{ title: string; provider: string; sourceUrl: string; channelOrContributor: string | null; reason: string }>;
    transcriptedNoTalkingPoints: Array<{ title: string; provider: string; sourceUrl: string; channelOrContributor: string | null }>;
  };
  sections: Array<any>;
};

function normalizeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let normalized = url.trim();
  if (!normalized) return null;
  for (let i = 0; i < 3; i++) {
    try { const d = decodeURIComponent(normalized); if (d === normalized) break; normalized = d; } catch { break; }
  }
  normalized = normalized.replace(/(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[^&?]+)\?t=(\d+)/i, "$1&t=$2");
  try {
    const p = new URL(normalized);
    if (/youtube\.com$/i.test(p.hostname) && p.pathname === "/watch") {
      const v = p.searchParams.get("v");
      if (v?.includes("?t=")) { const [id, t] = v.split("?t="); p.searchParams.set("v", id); if (t && !p.searchParams.get("t")) p.searchParams.set("t", t); }
    }
    return p.toString();
  } catch { return normalized; }
}

function stripTimeParam(url: string | null | undefined): string {
  const n = normalizeExternalUrl(url);
  if (!n) return "";
  try { const p = new URL(n); p.searchParams.delete("t"); return p.toString(); } catch { return n.replace(/([?&])t=\d+(&?)/g, (_m, pre: string, suf: string) => pre === "?" && suf ? "?" : suf ? pre : ""); }
}

function trimText(text: string | null | undefined, max: number): string | null {
  const v = (text ?? "").replace(/\s+/g, " ").trim();
  if (!v) return null;
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
}

function formatRange(startMs: number | null | undefined, endMs: number | null | undefined): string | null {
  if (typeof startMs !== "number" || startMs < 0) return null;
  const fmt = (ms: number) => { const s = Math.floor(ms/1000), h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60; return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}` : `${m}:${String(sec).padStart(2,"0")}`; };
  const start = fmt(startMs);
  const end = typeof endMs === "number" && endMs > 0 ? fmt(endMs) : null;
  return end && end !== start ? `${start}–${end}` : start;
}

function Section({
  id,
  label,
  count,
  defaultOpen = true,
  children,
}: {
  id: string;
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={id} className="border border-[var(--border)] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-primary)]">
          {label}{count != null ? ` · ${count}` : ""}
        </span>
        <span className="text-[var(--text-muted)] text-sm flex-shrink-0 transition-transform duration-200" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
      </button>
      {open && <div className="px-4 pb-4 pt-3 bg-[var(--bg-primary)]">{children}</div>}
    </div>
  );
}

function Thumbnail({ src, alt }: { src: string | null | undefined; alt: string }) {
  if (!src) return null;
  const normalized = normalizeExternalUrl(src) ?? src;
  return (
    <img
      src={normalized}
      alt={alt}
      style={{ width: 88, height: 50, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
      loading="lazy"
    />
  );
}

function ClipRow({
  href,
  title,
  provider,
  channel,
  pts,
  quoteText,
  visualUrl,
}: {
  href: string;
  title: string;
  provider: string;
  channel: string | null;
  pts: number;
  quoteText?: string | null;
  visualUrl?: string | null;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[#1a1a26] last:border-0">
      <Thumbnail src={visualUrl} alt={title} />
      <div className="min-w-0 flex-1">
        <a
          href={normalizeExternalUrl(href) ?? href}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-blue)] underline decoration-[var(--accent-blue)]/30 underline-offset-2 leading-5"
        >
          {title}
        </a>
        <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
          {provider}{channel ? ` · ${channel}` : ""}{pts > 0 ? ` · ${pts} pts` : ""}
        </div>
        {quoteText ? (
          <blockquote className="mt-1.5 border-l-2 border-[#ff8c42] pl-3 text-xs leading-5 text-[var(--text-secondary)]">
            {trimText(quoteText, 180)}
          </blockquote>
        ) : null}
      </div>
    </div>
  );
}

export default function WriterPacketClient({ report }: { report: WriterPack }) {
  // Data processing
  const quoteGroups = new Map<string, WriterPack["importantQuotes"][number][]>();
  const clipVisualMap = new Map(
    report.insaneClips.map((clip) => [
      stripTimeParam(clip.sourceUrl),
      { visualUrl: clip.visualUrl ?? null, visualKind: clip.visualKind ?? null },
    ])
  );

  for (const quote of report.importantQuotes) {
    const key = stripTimeParam(quote.sourceUrl);
    if (!key) continue;
    const list = quoteGroups.get(key) ?? [];
    list.push(quote);
    quoteGroups.set(key, list);
  }

  const featuredClips = report.insaneClips
    .map((clip) => {
      const key = stripTimeParam(clip.sourceUrl);
      const quotes = quoteGroups.get(key) ?? [];
      return { ...clip, quotes };
    })
    .sort((l, r) => {
      if (r.quotes.length !== l.quotes.length) return r.quotes.length - l.quotes.length;
      if (r.talkingPointCount !== l.talkingPointCount) return r.talkingPointCount - l.talkingPointCount;
      return l.title.localeCompare(r.title);
    });

  const primaryClips = featuredClips
    .filter((c) => c.quotes.length > 0 || c.talkingPointCount > 0)
    .slice(0, 12);

  const extraSourceItems = [
    ...featuredClips
      .filter((c) => !primaryClips.some((s) => s.sourceUrl === c.sourceUrl))
      .map((c) => ({
        title: c.title,
        provider: c.provider,
        sourceUrl: c.sourceUrl,
        channelOrContributor: c.channelOrContributor,
        reason: c.talkingPointCount > 0 ? `${c.talkingPointCount} talking point${c.talkingPointCount === 1 ? "" : "s"}` : null,
      })),
    ...report.queues.transcriptedNoTalkingPoints.map((i) => ({ ...i, reason: "Transcripted, no clean quote made the pack." })),
    ...report.queues.unsupportedSourceQueue.map((i) => ({ ...i, reason: i.reason ?? "Additional source link." })),
    ...report.queues.missingTranscriptQueue.map((i) => ({ ...i, reason: i.reason ?? "Useful source, no transcript yet." })),
  ]
    .filter(
      (item, index, array) =>
        array.findIndex((c) => stripTimeParam(c.sourceUrl) === stripTimeParam(item.sourceUrl)) === index
    )
    .map((item) => ({
      ...item,
      ...(clipVisualMap.get(stripTimeParam(item.sourceUrl)) ?? {}),
    }));

  const audienceReaction = report.audienceReaction.slice(0, 10);
  const articleReceipts = report.articleReceipts.slice(0, 12);
  const storyPoints = (report.topSummary.storyPoints.length > 0
    ? report.topSummary.storyPoints
    : report.summary.storyPoints
  ).slice(0, 10);
  const tiktokClips = report.tiktokClips ?? [];

  const navItems = [
    { href: "#overview", label: "Overview" },
    { href: "#clips", label: `Clips·${primaryClips.length}` },
    ...(tiktokClips.length > 0 ? [{ href: "#tiktok", label: `TikTok·${tiktokClips.length}` }] : []),
    { href: "#quotes", label: `Quotes·${report.importantQuotes.length}` },
    { href: "#reaction", label: `Reaction·${audienceReaction.length}` },
    { href: "#articles", label: `Articles·${articleReceipts.length}` },
    ...(extraSourceItems.length > 0 ? [{ href: "#extra", label: `Extra·${extraSourceItems.length}` }] : []),
  ];

  const generatedDate = report.meta.generatedAt
    ? new Date(report.meta.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <main className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Sticky Nav */}
      <nav className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg-primary)]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center gap-1.5 overflow-x-auto px-4 py-2">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent-blue)] pr-2 border-r border-[var(--border)] mr-1">
            WRITER PACK
          </span>
          {navItems.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="shrink-0 rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-light)] transition-colors"
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      <div className="mx-auto max-w-[1200px] flex flex-col gap-3 px-4 py-4">
        {/* Compact Header */}
        <header className="flex items-start justify-between gap-4 px-1 py-1">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] leading-tight">
            {report.meta.title}
          </h1>
          {generatedDate && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)] border border-[var(--border)] rounded-full px-2.5 py-1 mt-0.5">
              {generatedDate}
            </span>
          )}
        </header>

        {/* Stats Row */}
        <div className="flex flex-wrap gap-2">
          {[
            `${report.summary.clipsWithTranscript} clips`,
            `${primaryClips.filter((c) => c.quotes.length > 0).length} quote-backed`,
            `${report.summary.totalTalkingPoints} talking pts`,
            `${articleReceipts.length} articles`,
          ].map((chip) => (
            <span key={chip} className="text-[11px] font-semibold text-[var(--text-secondary)] border border-[var(--border)] rounded-full px-3 py-1 bg-[var(--bg-secondary)]">
              {chip}
            </span>
          ))}
        </div>

        {/* STORY OVERVIEW */}
        <Section id="overview" label="STORY OVERVIEW" defaultOpen>
          <p className="text-sm leading-6 text-[var(--text-primary)] mb-3">
            {report.topSummary.shortSummary || report.summary.researchSummary}
          </p>
          {report.summary.whyItMattersNow ? (
            <div className="mb-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent-orange)]">WHY IT MATTERS: </span>
              <span className="text-xs leading-5 text-[var(--text-secondary)]">{report.summary.whyItMattersNow}</span>
            </div>
          ) : null}
          {storyPoints.length > 0 ? (
            <ul className="space-y-1">
              {storyPoints.map((point, i) => (
                <li key={i} className="flex items-start gap-2 text-xs leading-5 text-[var(--text-secondary)]">
                  <span className="text-[var(--text-muted)] flex-shrink-0 mt-0.5">·</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        {/* KEY CLIPS */}
        <Section id="clips" label="KEY CLIPS" count={primaryClips.length} defaultOpen>
          <div>
            {primaryClips.map((clip) => (
              <ClipRow
                key={clip.sourceUrl}
                href={clip.sourceUrl}
                title={clip.title}
                provider={clip.provider}
                channel={clip.channelOrContributor}
                pts={clip.talkingPointCount}
                quoteText={clip.quotes[0]?.quoteText ?? clip.whyUse}
                visualUrl={clip.visualUrl}
              />
            ))}
          </div>
        </Section>

        {/* TIKTOK */}
        {tiktokClips.length > 0 ? (
          <Section id="tiktok" label="TIKTOK" count={tiktokClips.length} defaultOpen>
            <div>
              {tiktokClips.map((clip) => (
                <ClipRow
                  key={clip.sourceUrl}
                  href={clip.sourceUrl}
                  title={clip.title}
                  provider={clip.provider}
                  channel={clip.channelOrContributor}
                  pts={clip.talkingPointCount}
                  quoteText={clip.primaryQuote ?? clip.whyUse}
                  visualUrl={clip.visualUrl}
                />
              ))}
            </div>
          </Section>
        ) : null}

        {/* IMPORTANT QUOTES */}
        <Section id="quotes" label="IMPORTANT QUOTES" count={report.importantQuotes.length} defaultOpen>
          {report.importantQuotes.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {report.importantQuotes.map((quote, idx) => {
                const range = formatRange(quote.startMs, quote.endMs);
                const provenanceLabel =
                  quote.provenance === "packet_quote" ? "research quote"
                  : quote.provenance === "packet_transcript" ? "transcript"
                  : quote.provenance === "mission_scan" ? "mission scan"
                  : String(quote.provenance).replace(/_/g, " ");
                return (
                  <div key={`${quote.sourceUrl ?? quote.sourceTitle}-${idx}`} className="border border-[var(--border)] rounded-lg p-3 bg-[var(--bg-secondary)]">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="text-xs font-semibold text-[var(--accent-blue)] truncate">
                        {quote.sourceUrl ? (
                          <a href={normalizeExternalUrl(quote.sourceUrl) ?? quote.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                            {trimText(quote.sourceTitle, 60)}
                          </a>
                        ) : (
                          trimText(quote.sourceTitle, 60)
                        )}
                      </div>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] flex-shrink-0">
                        {provenanceLabel}{range ? ` · ${range}` : ""}
                      </span>
                    </div>
                    <blockquote className="border-l-2 border-[#ff8c42] pl-3 text-xs leading-5 text-[var(--text-primary)]">
                      {trimText(quote.quoteText, 280)}
                    </blockquote>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-muted)]">No top quotes selected yet.</div>
          )}
        </Section>

        {/* AUDIENCE REACTION */}
        <Section id="reaction" label="AUDIENCE REACTION" count={audienceReaction.length} defaultOpen>
          {audienceReaction.length > 0 ? (
            <div>
              {audienceReaction.map((item) => (
                <div key={item.url} className="flex items-start gap-3 py-2.5 border-b border-[#1a1a26] last:border-0">
                  <Thumbnail src={item.visualUrl} alt={item.title} />
                  <div className="min-w-0 flex-1">
                    <a
                      href={normalizeExternalUrl(item.url) ?? item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-blue)] underline decoration-[var(--accent-blue)]/30 underline-offset-2 leading-5"
                    >
                      {item.title}
                    </a>
                    <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                      {item.publishedAt ? `${item.publishedAt} · ` : ""}{Math.round(item.relevanceScore)}%
                    </div>
                    {item.snippet ? (
                      <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                        {trimText(item.snippet, 160)}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-muted)]">No audience reaction sources yet.</div>
          )}
        </Section>

        {/* ARTICLE RECEIPTS — starts CLOSED */}
        <Section id="articles" label="ARTICLE RECEIPTS" count={articleReceipts.length} defaultOpen={false}>
          {articleReceipts.length > 0 ? (
            <div>
              {articleReceipts.map((article) => (
                <div key={article.url} className="py-2.5 border-b border-[#1a1a26] last:border-0">
                  <a
                    href={normalizeExternalUrl(article.url) ?? article.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-blue)] underline decoration-[var(--accent-blue)]/30 underline-offset-2 leading-5"
                  >
                    {article.title}
                  </a>
                  <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                    {article.source} · {article.role}{article.publishedAt ? ` · ${article.publishedAt}` : ""}
                  </div>
                  {(article.keyPoints?.slice(0, 2) ?? []).length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {article.keyPoints!.slice(0, 2).map((kp, i) => (
                        <li key={i} className="text-xs leading-5 text-[var(--text-secondary)] flex items-start gap-1.5">
                          <span className="text-[var(--text-muted)] flex-shrink-0">·</span>
                          <span>{trimText(kp, 120)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : article.snippet ? (
                    <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{trimText(article.snippet, 160)}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-muted)]">No article receipts yet.</div>
          )}
        </Section>

        {/* EXTRA SOURCES — starts CLOSED */}
        {extraSourceItems.length > 0 ? (
          <Section id="extra" label="EXTRA SOURCES" count={extraSourceItems.length} defaultOpen={false}>
            <div>
              {extraSourceItems.map((item) => (
                <div key={item.sourceUrl} className="flex items-start gap-3 py-2 border-b border-[#1a1a26] last:border-0">
                  <div className="min-w-0 flex-1">
                    <a
                      href={normalizeExternalUrl(item.sourceUrl) ?? item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-blue)] underline decoration-[var(--accent-blue)]/30 underline-offset-2 leading-5"
                    >
                      {item.title}
                    </a>
                    <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                      {item.provider ?? "source"}{item.channelOrContributor ? ` · ${item.channelOrContributor}` : ""}
                    </div>
                    {item.reason ? (
                      <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{trimText(item.reason, 120)}</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}
      </div>
    </main>
  );
}
