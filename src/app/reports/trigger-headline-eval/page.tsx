import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Trigger Headline Eval — Moon News",
};

type SummaryMetric = {
  label: string;
  value: string;
};

type MatchRow = {
  moonVideo: string;
  pulledStory: string;
  matchedHeadline: string;
  finalScore: string;
  visibility: string;
  moonFit: string;
  controversy: string;
  views: string;
};

type UnmatchedRow = {
  moonVideo: string;
  query: string;
  referenceHeadline: string;
  summary: string;
  reason: string;
};

type ReportData = {
  generatedAt: string;
  moonSample: string;
  matched: string;
  model: string;
  summary: SummaryMetric[];
  topMatches: MatchRow[];
  falseNegatives: MatchRow[];
  unmatched: UnmatchedRow[];
};

function stripTicks(value: string) {
  return value.replace(/`/g, "").trim();
}

function parseHeaderValue(markdown: string, labels: string | string[]) {
  const labelList = Array.isArray(labels) ? labels : [labels];

  for (const label of labelList) {
    const match = markdown.match(new RegExp(`- ${label}: (.+)`));
    if (match) {
      return stripTicks(match[1]);
    }
  }

  return "n/a";
}

function parseSectionBody(markdown: string, heading: string) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`## ${escapedHeading}\\n\\n([\\s\\S]*?)(?:\\n## |$)`)
  );
  return match?.[1]?.trim() ?? "";
}

function parseSummary(markdown: string): SummaryMetric[] {
  const body = parseSectionBody(markdown, "Summary");
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        return null;
      }

      return {
        label: line.slice(2, separatorIndex).trim(),
        value: stripTicks(line.slice(separatorIndex + 1).trim()),
      } satisfies SummaryMetric;
    })
    .filter((metric): metric is SummaryMetric => Boolean(metric));
}

function splitMarkdownRow(line: string) {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function parseMatchTable(markdown: string, heading: string): MatchRow[] {
  const body = parseSectionBody(markdown, heading);
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const dataLines = lines.filter(
    (line, index) =>
      line.startsWith("|") &&
      index >= 2 &&
      !/^(\|\s*:?-+:?\s*)+\|$/.test(line)
  );

  return dataLines
    .map((line) => splitMarkdownRow(line))
    .filter((cells) => cells.length >= 8)
    .map((cells) => ({
      moonVideo: cells[0],
      pulledStory: cells[1],
      matchedHeadline: cells[2],
      finalScore: cells[3],
      visibility: cells[4],
      moonFit: cells[5],
      controversy: cells[6],
      views: cells[7],
    }));
}

function parseUnmatched(markdown: string): UnmatchedRow[] {
  const body = parseSectionBody(markdown, "Unmatched Videos");
  const blocks = body
    .split("\n- ")
    .map((block, index) => (index === 0 ? block : `- ${block}`))
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim());
      const moonVideo = lines[0]?.replace(/^- /, "").trim();
      if (!moonVideo) {
        return null;
      }

      const extract = (prefix: string) =>
        lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() ?? "n/a";

      return {
        moonVideo,
        query: extract("query: "),
        referenceHeadline: extract("reference headline: "),
        summary: extract("summary: "),
        reason: extract("reason: "),
      } satisfies UnmatchedRow;
    })
    .filter((row): row is UnmatchedRow => Boolean(row));
}

async function loadReport(): Promise<ReportData> {
  try {
    const researchDir = path.resolve(process.cwd(), "research");
    const reportFile = (await readdir(researchDir))
      .filter((entry) => /^trigger-headline-eval-\d{4}-\d{2}-\d{2}\.md$/.test(entry))
      .sort()
      .at(-1);

    if (!reportFile) {
      notFound();
    }

    const reportPath = path.resolve(researchDir, reportFile);
    const markdown = await readFile(reportPath, "utf8");
    return {
      generatedAt: parseHeaderValue(markdown, "Generated at"),
      moonSample: parseHeaderValue(markdown, "Moon upload sample"),
      matched: parseHeaderValue(markdown, ["Story matched", "Trigger article matched"]),
      model: parseHeaderValue(markdown, "Model env"),
      summary: parseSummary(markdown),
      topMatches: parseMatchTable(markdown, "Top Matches"),
      falseNegatives: parseMatchTable(markdown, "False Negatives"),
      unmatched: parseUnmatched(markdown),
    };
  } catch {
    notFound();
  }
}

function renderMetricLabel(label: string) {
  return label
    .replace(/^Trigger headlines /, "")
    .replace(/^High-performing Moon videos /, "High-perf videos ");
}

export default async function TriggerHeadlineEvalPage() {
  const report = await loadReport();

  return (
    <main className="min-h-[calc(100vh-32px)] bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto w-[min(1500px,calc(100vw-24px))] py-5">
        <section className="mb-4 rounded-[18px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-5 py-5">
          <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[var(--accent-green)]">
            Moon Internal
          </div>
          <h1 className="mb-2 text-[28px] leading-none font-semibold">
            Trigger Headline Eval
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Moon videos rewritten as likely trigger headlines, then matched only against real pulled board stories and rescored with the live board prompt.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
            <span className="rounded-full border border-[var(--border)] px-3 py-1">
              {report.moonSample}
            </span>
            <span className="rounded-full border border-[var(--border)] px-3 py-1">
              Matched: {report.matched}
            </span>
            <span className="rounded-full border border-[var(--border)] px-3 py-1">
              Model: {report.model}
            </span>
            <span className="rounded-full border border-[var(--border)] px-3 py-1">
              Generated: {report.generatedAt}
            </span>
          </div>
        </section>

        <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {report.summary.map((metric) => (
            <article
              key={metric.label}
              className="rounded-[18px] border border-[var(--border)] bg-[rgba(18,18,26,0.88)] px-4 py-4"
            >
              <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                {renderMetricLabel(metric.label)}
              </div>
              <div className="mt-2 font-mono text-xl font-semibold text-[var(--text-primary)]">
                {metric.value}
              </div>
            </article>
          ))}
        </section>

        <section className="mb-4 overflow-hidden rounded-[18px] border border-[var(--border)] bg-[rgba(18,18,26,0.88)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Top Matches</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[rgba(255,255,255,0.03)] text-left text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <th className="px-4 py-3">Moon Video</th>
                  <th className="px-4 py-3">Pulled Story</th>
                  <th className="px-4 py-3">Matched Headline</th>
                  <th className="px-4 py-3">Final</th>
                  <th className="px-4 py-3">Vis</th>
                  <th className="px-4 py-3">Fit</th>
                  <th className="px-4 py-3">Controv</th>
                  <th className="px-4 py-3">Views</th>
                </tr>
              </thead>
              <tbody>
                {report.topMatches.map((row) => (
                  <tr
                    key={`${row.moonVideo}-${row.pulledStory}-${row.matchedHeadline}`}
                    className="border-b border-[rgba(255,255,255,0.05)] align-top hover:bg-[rgba(255,255,255,0.02)]"
                  >
                    <td className="max-w-[320px] px-4 py-3 text-sm leading-6">{row.moonVideo}</td>
                    <td className="max-w-[640px] px-4 py-3 text-sm leading-6 text-[var(--text-secondary)]">
                      {row.pulledStory}
                    </td>
                    <td className="max-w-[640px] px-4 py-3 text-sm leading-6 text-[var(--text-secondary)]">
                      {row.matchedHeadline}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">{row.finalScore}</td>
                    <td className="px-4 py-3 font-mono text-sm">{row.visibility}</td>
                    <td className="px-4 py-3 font-mono text-sm">{row.moonFit}</td>
                    <td className="px-4 py-3 font-mono text-sm">{row.controversy}</td>
                    <td className="px-4 py-3 font-mono text-sm">{row.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-4 overflow-hidden rounded-[18px] border border-[var(--border)] bg-[rgba(18,18,26,0.88)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold">False Negatives</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[rgba(255,255,255,0.03)] text-left text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <th className="px-4 py-3">Moon Video</th>
                  <th className="px-4 py-3">Pulled Story</th>
                  <th className="px-4 py-3">Matched Headline</th>
                  <th className="px-4 py-3">Final</th>
                  <th className="px-4 py-3">Vis</th>
                  <th className="px-4 py-3">Fit</th>
                  <th className="px-4 py-3">Controv</th>
                  <th className="px-4 py-3">Views</th>
                </tr>
              </thead>
              <tbody>
                {report.falseNegatives.map((row) => (
                  <tr
                    key={`${row.moonVideo}-${row.pulledStory}-${row.matchedHeadline}`}
                    className="border-b border-[rgba(255,255,255,0.05)] align-top hover:bg-[rgba(255,255,255,0.02)]"
                  >
                    <td className="max-w-[320px] px-4 py-3 text-sm leading-6">{row.moonVideo}</td>
                    <td className="max-w-[640px] px-4 py-3 text-sm leading-6 text-[var(--text-secondary)]">
                      {row.pulledStory}
                    </td>
                    <td className="max-w-[640px] px-4 py-3 text-sm leading-6 text-[var(--text-secondary)]">
                      {row.matchedHeadline}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">{row.finalScore}</td>
                    <td className="px-4 py-3 font-mono text-sm">{row.visibility}</td>
                    <td className="px-4 py-3 font-mono text-sm">{row.moonFit}</td>
                    <td className="px-4 py-3 font-mono text-sm">{row.controversy}</td>
                    <td className="px-4 py-3 font-mono text-sm">{row.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-[18px] border border-[var(--border)] bg-[rgba(18,18,26,0.88)] px-4 py-4">
          <h2 className="mb-3 text-sm font-semibold">Unmatched Cases</h2>
          <div className="space-y-3">
            {report.unmatched.map((row) => (
              <article
                key={row.moonVideo}
                className="rounded-[14px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-4"
              >
                <h3 className="text-sm font-semibold">{row.moonVideo}</h3>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--text-primary)]">Reference:</span>{" "}
                  {row.referenceHeadline}
                </p>
                <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">{row.query}</p>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">{row.summary}</p>
                <p className="mt-2 text-sm text-[var(--text-muted)]">{row.reason}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
