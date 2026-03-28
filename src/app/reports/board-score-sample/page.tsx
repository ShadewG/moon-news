import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Board Score Sample — Moon News",
};

type StoryRow = {
  title: string;
  slug: string;
  finalScore: number;
  boardVisibilityScore: number | null;
  aiMoonFit: number | null;
  aiControversy: number | null;
  moonRelevance: number | null;
};

type ReportData = {
  generatedAt: string;
  sampleSizeLabel: string;
  samplingWindow: string;
  rows: StoryRow[];
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripSampleIndex(value: string) {
  return value.replace(/^\d+\.\s+/, "").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTicks(value: string) {
  return value.replace(/`/g, "").trim();
}

function parseHeaderValue(markdown: string, label: string) {
  const match = markdown.match(new RegExp(`- ${escapeRegExp(label)}: (.+)`));
  return match ? stripTicks(match[1]) : "n/a";
}

function extractNumber(body: string, label: string): number | null {
  const pattern = new RegExp(`- ${escapeRegExp(label)}: \`([^\`]+)\``);
  const match = body.match(pattern);

  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMarkdownDocument(markdown: string): StoryRow[] {
  const parts = markdown.split("\n## ").slice(1);

  return parts
    .map((part) => {
      const lines = part.split("\n");
      const title = stripSampleIndex(lines[0]?.trim() ?? "");
      const body = lines.slice(1).join("\n");

      if (!title) {
        return null;
      }

      const finalScore = extractNumber(body, "Final score");
      if (finalScore === null) {
        return null;
      }

      return {
        title,
        slug: slugify(title),
        finalScore,
        boardVisibilityScore: extractNumber(body, "Board visibility score"),
        aiMoonFit: extractNumber(body, "AI moon fit"),
        aiControversy: extractNumber(body, "AI controversy"),
        moonRelevance: extractNumber(body, "Moon relevance"),
      } satisfies StoryRow;
    })
    .filter((story): story is StoryRow => Boolean(story))
    .sort((a, b) => {
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore;
      }

      if ((b.boardVisibilityScore ?? -1) !== (a.boardVisibilityScore ?? -1)) {
        return (b.boardVisibilityScore ?? -1) - (a.boardVisibilityScore ?? -1);
      }

      return (b.aiControversy ?? -1) - (a.aiControversy ?? -1);
    });
}

async function loadReport(): Promise<ReportData> {
  const reportPath = path.resolve(
    process.cwd(),
    "research"
  );

  try {
    const reportFile = (
      await Promise.all(
        (await readdir(reportPath))
          .filter((entry) => /^board-score-sample-\d{4}-\d{2}-\d{2}-random-\d+\.md$/.test(entry))
          .map(async (entry) => ({
            entry,
            mtimeMs: (await stat(path.resolve(reportPath, entry))).mtimeMs,
          }))
      )
    )
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
      .at(-1)?.entry;

    if (!reportFile) {
      notFound();
    }

    const markdown = await readFile(path.resolve(reportPath, reportFile), "utf8");
    return {
      generatedAt: parseHeaderValue(markdown, "Generated at"),
      sampleSizeLabel: parseHeaderValue(markdown, "Sample size"),
      samplingWindow: parseHeaderValue(markdown, "Sampling window"),
      rows: parseMarkdownDocument(markdown),
    };
  } catch {
    notFound();
  }
}

function formatScore(value: number | null) {
  return value === null ? "n/a" : String(value);
}

export default async function BoardScoreSamplePage() {
  const report = await loadReport();
  const topScore = report.rows[0]?.finalScore ?? 0;

  return (
    <main className="min-h-[calc(100vh-32px)] bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto w-[min(1480px,calc(100vw-24px))] py-5">
        <section className="mb-4 rounded-[18px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-5 py-5">
          <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[var(--accent-green)]">
            Moon Internal
          </div>
          <h1 className="mb-2 text-[28px] leading-none font-semibold">
            Board Score Sample
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Real pulled board stories from the last few days, rescored with the live prompt and sorted highest to lowest by final score.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
            <span className="rounded-full border border-[var(--border)] px-3 py-1">
              {report.sampleSizeLabel}
            </span>
            <span className="rounded-full border border-[var(--border)] px-3 py-1">
              {report.samplingWindow}
            </span>
            <span className="rounded-full border border-[var(--border)] px-3 py-1">
              Top score: {topScore}
            </span>
            <span className="rounded-full border border-[var(--border)] px-3 py-1">
              Generated: {report.generatedAt}
            </span>
          </div>
        </section>

        <section className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[rgba(18,18,26,0.88)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[rgba(255,255,255,0.03)] text-left text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Headline</th>
                  <th className="px-4 py-3">Final</th>
                  <th className="px-4 py-3">Visibility</th>
                  <th className="px-4 py-3">Moon Fit</th>
                  <th className="px-4 py-3">AI Controv</th>
                  <th className="px-4 py-3">Moon Rel</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, index) => (
                  <tr
                    key={row.slug}
                    className="border-b border-[rgba(255,255,255,0.05)] align-top hover:bg-[rgba(255,255,255,0.02)]"
                  >
                    <td className="px-4 py-3 font-mono text-sm text-[var(--text-muted)]">
                      {index + 1}
                    </td>
                    <td className="max-w-[860px] px-4 py-3 text-sm leading-6 text-[var(--text-primary)]">
                      {row.title}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-[var(--text-primary)]">
                      {row.finalScore}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-[var(--text-secondary)]">
                      {formatScore(row.boardVisibilityScore)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-[var(--text-secondary)]">
                      {formatScore(row.aiMoonFit)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-[var(--text-secondary)]">
                      {formatScore(row.aiControversy)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-[var(--text-secondary)]">
                      {formatScore(row.moonRelevance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
