import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";

type MediaCollectorReport = {
  meta: {
    slug: string;
    title: string;
    generatedAt: string;
  };
  summary: {
    totalQueries: number;
    totalCollected: number;
    totalWithTranscript: number;
    providerCounts: Record<string, number>;
  };
  globalMediaQueries: string[];
  sectionMediaQueries: Array<{
    heading: string;
    mediaQueries: string[];
  }>;
  clips: Array<{
    title: string;
    provider: string;
    sourceUrl: string;
    channelOrContributor: string | null;
    relevanceScore: number;
    matchedQueries: string[];
    matchedSections: string[];
    transcriptRecovered: boolean;
    transcriptSegments: number;
    fromPacket: boolean;
    fromSectionPacket: boolean;
    fromQuerySearch: boolean;
  }>;
};

async function loadReport(slug: string) {
  const filePath = path.resolve(process.cwd(), "research", `media-collector-${slug}.json`);
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as MediaCollectorReport;
  } catch {
    notFound();
  }
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

export default async function MediaCollectorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const report = await loadReport(slug);

  return (
    <main
      style={
        {
          "--bg-primary": "#f5f0e7",
          "--bg-secondary": "#fffaf0",
          "--bg-tertiary": "#f0e6d2",
          "--text-primary": "#23170a",
          "--text-muted": "#6d5a42",
          "--border": "rgba(35,23,10,0.12)",
          "--accent": "#b8642b",
        } as CSSProperties
      }
      className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]"
    >
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="mb-8">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            Media Collector
          </div>
          <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-tight">
            {report.meta.title}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
            Editor-facing video inventory built from the story packet's global and section media
            queries. This is broader than the writing shortlist.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Collected Clips" value={report.summary.totalCollected} />
          <StatCard label="Queries Run" value={report.summary.totalQueries} />
          <StatCard label="With Transcript" value={report.summary.totalWithTranscript} />
          <StatCard
            label="Providers"
            value={Object.keys(report.summary.providerCounts).length}
          />
        </div>

        <section className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
          <h2 className="text-2xl font-semibold">Query Lanes</h2>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Global Media Queries
              </h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--text-primary)]">
                {report.globalMediaQueries.map((query) => (
                  <li key={query} className="rounded-xl bg-[var(--bg-tertiary)] px-3 py-2">
                    {query}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Section Queries
              </h3>
              <div className="mt-3 space-y-4">
                {report.sectionMediaQueries.map((section) => (
                  <div key={section.heading} className="rounded-2xl bg-[var(--bg-tertiary)] p-4">
                    <div className="font-semibold">{section.heading}</div>
                    <ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--text-muted)]">
                      {section.mediaQueries.map((query) => (
                        <li key={query}>{query}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
          <h2 className="text-2xl font-semibold">Collected Clips</h2>
          <div className="mt-6 space-y-4">
            {report.clips.map((clip, index) => (
              <article
                key={clip.sourceUrl}
                className="rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      #{index + 1} · {clip.provider}
                    </div>
                    <a
                      href={normalizeExternalUrl(clip.sourceUrl) ?? clip.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block text-lg font-semibold underline decoration-[var(--accent)]/35 underline-offset-2 hover:text-[var(--accent)]"
                    >
                      {clip.title}
                    </a>
                    {clip.channelOrContributor ? (
                      <div className="mt-1 text-sm text-[var(--text-muted)]">
                        {clip.channelOrContributor}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right text-sm text-[var(--text-muted)]">
                    <div>Score {clip.relevanceScore}</div>
                    <div>
                      Transcript {clip.transcriptRecovered ? `yes (${clip.transcriptSegments})` : "no"}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                  {clip.fromPacket ? (
                    <span className="rounded-full bg-[var(--bg-secondary)] px-3 py-1">packet</span>
                  ) : null}
                  {clip.fromSectionPacket ? (
                    <span className="rounded-full bg-[var(--bg-secondary)] px-3 py-1">section</span>
                  ) : null}
                  {clip.fromQuerySearch ? (
                    <span className="rounded-full bg-[var(--bg-secondary)] px-3 py-1">query search</span>
                  ) : null}
                  {clip.matchedSections.map((section) => (
                    <span key={section} className="rounded-full bg-[var(--bg-secondary)] px-3 py-1">
                      {section}
                    </span>
                  ))}
                </div>

                {clip.matchedQueries.length > 0 ? (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">
                      Matched Queries ({clip.matchedQueries.length})
                    </summary>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--text-muted)]">
                      {clip.matchedQueries.map((query) => (
                        <li key={query}>{query}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
