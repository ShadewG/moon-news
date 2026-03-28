import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";

type MissionScanPoint = {
  label: string;
  quoteText: string;
  speaker: string | null;
  startMs: number;
  endMs: number;
  relevanceScore: number;
  whyRelevant: string;
  matchedSectionHeadings: string[];
  topics: string[];
  sourceTitle: string;
  sourceUrl: string;
  channelOrContributor: string | null;
};

type MissionScanReport = {
  meta: {
    slug: string;
    title: string;
    generatedAt: string;
  };
  mission: {
    missionTitle: string;
    missionObjective: string;
    missionInstructions: string[];
    model: string;
  };
  summary: {
    totalClips: number;
    eligibleClips: number;
    transcriptedClips: number;
    clipsScanned: number;
    clipsWithTalkingPoints: number;
    totalTalkingPoints: number;
  };
  sections: Array<{
    heading: string;
    mission: string;
    lookFor: string[];
    talkingPoints: MissionScanPoint[];
    clips: Array<{
      title: string;
      sourceUrl: string;
      channelOrContributor: string | null;
      talkingPointCount: number;
    }>;
  }>;
  clips: Array<{
    title: string;
    provider: string;
    sourceUrl: string;
    channelOrContributor: string | null;
    transcriptStatus: string;
    scanStatus: string;
    scanModel: string | null;
    missionSummary: string | null;
    talkingPoints: MissionScanPoint[];
  }>;
};

async function loadReport(slug: string) {
  const filePath = path.resolve(process.cwd(), "research", `media-mission-scan-${slug}.json`);
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as MissionScanReport;
  } catch {
    return null;
  }
}

function formatRange(startMs: number | null | undefined, endMs: number | null | undefined) {
  if (typeof startMs !== "number") return null;
  const toStamp = (value: number) => {
    const totalSeconds = Math.floor(value / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };
  return typeof endMs === "number" ? `${toStamp(startMs)}-${toStamp(endMs)}` : toStamp(startMs);
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength).trimEnd()}...`;
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4">
      <div className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function QuoteCard({ point }: { point: MissionScanPoint }) {
  const range = formatRange(point.startMs, point.endMs);
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-5">
      <div className="mb-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
        <span className="font-semibold text-[var(--text-primary)] normal-case tracking-normal">
          <a
            href={normalizeExternalUrl(point.sourceUrl) ?? point.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-[var(--accent-blue)]/30 underline-offset-2 hover:text-[var(--accent-blue)]"
          >
            {point.sourceTitle}
          </a>
        </span>
        {point.channelOrContributor ? <span>{point.channelOrContributor}</span> : null}
        {range ? <span>{range}</span> : null}
        <span>{Math.round(point.relevanceScore)}%</span>
      </div>
      <div className="mb-3 text-sm font-medium text-[var(--accent-blue)]">{point.label}</div>
      <blockquote className="border-l-2 border-[var(--accent-orange)] pl-4 text-[15px] leading-7 text-[var(--text-primary)] whitespace-pre-wrap">
        {point.quoteText}
      </blockquote>
      <div className="mt-4 space-y-1 text-sm leading-6 text-[var(--text-secondary)]">
        {point.speaker ? <p><span className="font-medium text-[var(--text-muted)]">Speaker:</span> {point.speaker}</p> : null}
        <p><span className="font-medium text-[var(--text-muted)]">Why relevant:</span> {truncateText(point.whyRelevant, 320)}</p>
        {point.topics.length > 0 ? (
          <p>
            <span className="font-medium text-[var(--text-muted)]">Topics:</span>{" "}
            {point.topics.slice(0, 3).map((topic) => truncateText(topic, 72)).join(", ")}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function formatTranscriptStatus(status: MissionScanReport["clips"][number]["transcriptStatus"]) {
  switch (status) {
    case "complete":
      return "transcript ready";
    case "missing":
      return "transcript not recovered";
    case "skipped":
      return "not scanned for transcript";
    default:
      return status;
  }
}

function formatScanStatus(status: MissionScanReport["clips"][number]["scanStatus"]) {
  switch (status) {
    case "complete":
      return "scan complete";
    case "cached":
      return "scan cached";
    case "missing_transcript":
      return "scan blocked by missing transcript";
    case "skipped":
      return "scan skipped";
    default:
      return status;
  }
}

export default async function MediaMissionScanPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const report = await loadReport(slug);

  if (!report) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-6 py-10 lg:px-10">
        <header className="rounded-[32px] border border-[var(--border)] bg-[linear-gradient(135deg,rgba(18,18,18,0.98),rgba(26,35,50,0.92))] p-8">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
            Media Mission Scan
          </div>
          <h1 className="mt-3 max-w-5xl text-4xl font-semibold tracking-tight text-[var(--text-primary)]">
            {report.meta.title}
          </h1>
          <p className="mt-4 max-w-5xl text-lg leading-8 text-[var(--text-secondary)]">
            {report.mission.missionObjective}
          </p>
          <div className="mt-5 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Mission model: {report.mission.model}
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Total Clips" value={report.summary.totalClips} />
          <StatCard label="Eligible Clips" value={report.summary.eligibleClips} />
          <StatCard label="Transcripted" value={report.summary.transcriptedClips} />
          <StatCard label="Scanned" value={report.summary.clipsScanned} />
          <StatCard label="Clips w/ Points" value={report.summary.clipsWithTalkingPoints} />
          <StatCard label="Talking Points" value={report.summary.totalTalkingPoints} />
        </section>

        <section className="rounded-[28px] border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
          <div className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">Mission</div>
          <h2 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{report.mission.missionTitle}</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {report.mission.missionInstructions.map((instruction) => (
              <div
                key={instruction}
                className="rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 text-sm leading-6 text-[var(--text-secondary)]"
              >
                {instruction}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-8">
          {report.sections.map((section) => (
            <article
              key={section.heading}
              className="rounded-[28px] border border-[var(--border)] bg-[var(--bg-secondary)] p-6"
            >
              <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="space-y-5">
                  <div>
                    <div className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">Section</div>
                    <h2 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{section.heading}</h2>
                  </div>
                  <p className="text-[15px] leading-7 text-[var(--text-secondary)]">{section.mission}</p>
                  <div className="space-y-3">
                    {section.lookFor.map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 text-sm leading-6 text-[var(--text-secondary)]"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4">
                    <div className="text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">Top Clips</div>
                    <div className="mt-3 space-y-3">
                      {section.clips.slice(0, 4).map((clip) => (
                        <div key={clip.sourceUrl} className="text-sm leading-6 text-[var(--text-secondary)]">
                          <a
                            href={normalizeExternalUrl(clip.sourceUrl) ?? clip.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-[var(--text-primary)] underline decoration-[var(--accent-blue)]/30 underline-offset-2 hover:text-[var(--accent-blue)]"
                          >
                            {clip.title}
                          </a>
                          <div className="text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
                            {clip.channelOrContributor ?? "unknown source"} · {clip.talkingPointCount} talking point{clip.talkingPointCount === 1 ? "" : "s"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  {section.talkingPoints.length > 0 ? (
                    section.talkingPoints.slice(0, 4).map((point) => <QuoteCard key={`${point.sourceUrl}-${point.startMs}`} point={point} />)
                  ) : (
                    <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm leading-6 text-[var(--text-muted)]">
                      No talking points assigned to this section yet.
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="rounded-[28px] border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
          <div className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">Clip Inventory</div>
          <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
            Showing the first {Math.min(report.clips.length, 12)} clips in the inventory. The full JSON artifact still contains all {report.clips.length}.
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {report.clips.slice(0, 12).map((clip) => (
              <article key={clip.sourceUrl} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4">
                <a
                  href={normalizeExternalUrl(clip.sourceUrl) ?? clip.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-base font-semibold text-[var(--text-primary)] underline decoration-[var(--accent-blue)]/30 underline-offset-2 hover:text-[var(--accent-blue)]"
                >
                  {clip.title}
                </a>
                <div className="mt-2 flex flex-wrap gap-2 text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <span>{clip.provider}</span>
                  <span>{formatTranscriptStatus(clip.transcriptStatus)}</span>
                  <span>{formatScanStatus(clip.scanStatus)}</span>
                  {clip.scanModel ? <span>{clip.scanModel}</span> : null}
                </div>
                {clip.channelOrContributor ? (
                  <div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{clip.channelOrContributor}</div>
                ) : null}
                {clip.missionSummary ? (
                  <div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                    {truncateText(clip.missionSummary, 200)}
                  </div>
                ) : null}
                {clip.talkingPoints.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <div className="text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      {clip.talkingPoints.length} talking point{clip.talkingPoints.length === 1 ? "" : "s"}
                    </div>
                    <div className="space-y-2">
                      {clip.talkingPoints.slice(0, 2).map((point) => (
                        <a
                          key={`${clip.sourceUrl}-${point.startMs}-${point.label}`}
                          href={normalizeExternalUrl(point.sourceUrl) ?? point.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-sm leading-6 text-[var(--text-secondary)] hover:border-[var(--accent-blue)]/40"
                        >
                          <div className="text-xs uppercase tracking-[0.12em] text-[var(--accent-blue)]">
                            {point.label} · {formatRange(point.startMs, point.endMs)}
                          </div>
                          <div className="mt-1 text-[var(--text-primary)]">
                            {truncateText(point.quoteText, 180)}
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : clip.scanStatus === "missing_transcript" ? (
                  <div className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
                    No transcript was recovered for this YouTube clip yet, so the scan could not extract quotes.
                  </div>
                ) : clip.scanStatus === "skipped" ? (
                  <div className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
                    This source is in the inventory, but it was not transcript-scanned on this pass.
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
