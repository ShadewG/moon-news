import "server-only";

import type { MoonAnalysisReport, MoonAnalysisRun } from "@/lib/moon-analysis";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => `<p>${escapeHtml(entry)}</p>`)
    .join("");
}

function renderBulletList(items: string[]) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function renderMoonAnalysisHtml(args: {
  run: Pick<MoonAnalysisRun, "id" | "scopeType" | "scopeStartDate" | "scopeEndDate">;
  report: MoonAnalysisReport;
}) {
  const { run, report } = args;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(report.title)}</title>
    <style>
      :root {
        --bg: #0b0d10;
        --panel: #11151b;
        --panel-2: #151a21;
        --ink: #edf2f7;
        --muted: #a2adbb;
        --line: #253042;
        --accent: #71d09a;
        --accent-2: #7fb3ff;
        --warn: #ffb86b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background:
          radial-gradient(circle at top left, rgba(113,208,154,0.08), transparent 28%),
          radial-gradient(circle at top right, rgba(127,179,255,0.08), transparent 30%),
          var(--bg);
        color: var(--ink);
        font: 16px/1.55 "Geist", "Inter", system-ui, sans-serif;
      }
      .shell {
        width: min(1180px, calc(100vw - 40px));
        margin: 0 auto;
        padding: 36px 0 72px;
      }
      .hero {
        padding: 28px 30px;
        border: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(17,21,27,0.98), rgba(12,15,20,0.98));
        border-radius: 22px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.35);
      }
      .eyebrow {
        color: var(--accent);
        font: 600 12px/1 "IBM Plex Mono", ui-monospace, monospace;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      h1 {
        margin: 14px 0 10px;
        font-size: clamp(34px, 5vw, 52px);
        line-height: 1.04;
        letter-spacing: -0.04em;
      }
      .dek {
        max-width: 880px;
        margin: 0;
        color: var(--muted);
        font-size: 18px;
      }
      .meta {
        margin-top: 18px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .chip {
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.03);
        color: var(--muted);
        border-radius: 999px;
        padding: 7px 12px;
        font: 600 11px/1 "IBM Plex Mono", ui-monospace, monospace;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .summary {
        margin-top: 26px;
        padding: 18px 20px;
        border: 1px solid rgba(113,208,154,0.18);
        border-radius: 18px;
        background: rgba(113,208,154,0.06);
      }
      .grid {
        display: grid;
        gap: 16px;
      }
      .stats {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        margin-top: 24px;
      }
      .card, .table-shell {
        border: 1px solid var(--line);
        background: var(--panel);
        border-radius: 18px;
      }
      .card {
        padding: 18px 18px 16px;
      }
      .card .label {
        color: var(--muted);
        font: 600 11px/1 "IBM Plex Mono", ui-monospace, monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .card .value {
        margin-top: 12px;
        font-size: 28px;
        line-height: 1.05;
        letter-spacing: -0.03em;
      }
      .card .note {
        margin-top: 10px;
        color: var(--muted);
        font-size: 14px;
      }
      section {
        margin-top: 26px;
      }
      h2 {
        margin: 0 0 14px;
        font-size: 24px;
        letter-spacing: -0.03em;
      }
      h3 {
        margin: 0 0 10px;
        font-size: 18px;
        letter-spacing: -0.02em;
      }
      p, li {
        color: var(--muted);
      }
      .table-shell {
        overflow: hidden;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 14px 16px;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
        text-align: left;
      }
      th {
        color: var(--muted);
        background: rgba(255,255,255,0.02);
        font: 600 11px/1 "IBM Plex Mono", ui-monospace, monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      tr:last-child td { border-bottom: 0; }
      .soft-grid {
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }
      .soft-grid .card {
        background: var(--panel-2);
      }
      .ideas {
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      }
      .idea-title {
        color: var(--ink);
        font-size: 20px;
        line-height: 1.2;
        letter-spacing: -0.03em;
      }
      .idea-meta {
        margin-top: 12px;
        font: 600 11px/1 "IBM Plex Mono", ui-monospace, monospace;
        color: var(--accent-2);
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .footer {
        margin-top: 28px;
        border-top: 1px solid var(--line);
        padding-top: 18px;
        color: var(--muted);
        font-size: 13px;
      }
      @media (max-width: 720px) {
        .shell { width: min(100vw - 20px, 1180px); padding-top: 18px; }
        .hero { padding: 22px 20px; border-radius: 18px; }
        th, td { padding: 12px; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="hero">
        <div class="eyebrow">Moon Analysis Agent</div>
        <h1>${escapeHtml(report.title)}</h1>
        <p class="dek">${escapeHtml(report.dek)}</p>
        <div class="meta">
          <span class="chip">${escapeHtml(report.scopeLabel)}</span>
          <span class="chip">${escapeHtml(report.windowLabel)}</span>
          <span class="chip">Run ${escapeHtml(run.id.slice(0, 8))}</span>
          ${report.pills.map((pill) => `<span class="chip">${escapeHtml(pill)}</span>`).join("")}
        </div>
        <div class="summary">
          ${renderParagraphs(report.summary)}
          ${renderBulletList(report.keyTakeaways)}
        </div>
      </header>

      <section>
        <h2>Numbers That Matter</h2>
        <div class="grid stats">
          ${report.numbersThatMatter
            .map(
              (card) => `<article class="card">
                <div class="label">${escapeHtml(card.label)}</div>
                <div class="value">${escapeHtml(card.value)}</div>
                <div class="note">${escapeHtml(card.note)}</div>
              </article>`
            )
            .join("")}
        </div>
      </section>

      <section>
        <h2>Cohort Scoreboard</h2>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>Video</th>
                <th>Views</th>
                <th>Avg View %</th>
                <th>Net Subs</th>
                <th>Watch Hours</th>
                <th>Read</th>
              </tr>
            </thead>
            <tbody>
              ${report.cohortRows
                .map(
                  (row) => `<tr>
                    <td><strong>${escapeHtml(row.title)}</strong></td>
                    <td>${escapeHtml(row.viewsLabel)}</td>
                    <td>${escapeHtml(row.avgViewPctLabel)}</td>
                    <td>${escapeHtml(row.netSubscribersLabel)}</td>
                    <td>${escapeHtml(row.watchHoursLabel)}</td>
                    <td>${escapeHtml(row.verdict)}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Transcript-Backed Findings</h2>
        <div class="grid soft-grid">
          ${report.transcriptFindings
            .map(
              (section) => `<article class="card">
                <h3>${escapeHtml(section.heading)}</h3>
                ${renderParagraphs(section.body)}
              </article>`
            )
            .join("")}
        </div>
      </section>

      <section>
        <h2>Retention Read</h2>
        <div class="grid soft-grid">
          ${report.retentionFindings
            .map(
              (section) => `<article class="card">
                <h3>${escapeHtml(section.heading)}</h3>
                ${renderParagraphs(section.body)}
              </article>`
            )
            .join("")}
        </div>
      </section>

      ${
        report.targetDiagnosis
          ? `<section>
              <h2>Target Diagnosis</h2>
              <article class="card">
                <h3>${escapeHtml(report.targetDiagnosis.title)}</h3>
                ${renderParagraphs(report.targetDiagnosis.summary)}
                ${renderBulletList(report.targetDiagnosis.bullets)}
              </article>
            </section>`
          : ""
      }

      <section>
        <h2>Winner Patterns</h2>
        <div class="grid soft-grid">
          ${report.winnerPatterns
            .map(
              (section) => `<article class="card">
                <h3>${escapeHtml(section.heading)}</h3>
                ${renderParagraphs(section.body)}
              </article>`
            )
            .join("")}
        </div>
      </section>

      <section>
        <h2>Historical Outlier Map</h2>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>Video</th>
                <th>Channel</th>
                <th>Value</th>
                <th>Read</th>
              </tr>
            </thead>
            <tbody>
              ${report.historicalOutliers
                .map(
                  (item) => `<tr>
                    <td><strong>${escapeHtml(item.title)}</strong></td>
                    <td>${escapeHtml(item.channel)}</td>
                    <td>${escapeHtml(item.value)}</td>
                    <td>${escapeHtml(item.note)}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>

      ${
        report.externalSignals.length > 0
          ? `<section>
              <h2>External Outlier Signals</h2>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Signal</th>
                      <th>Channel</th>
                      <th>Value</th>
                      <th>Read</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${report.externalSignals
                      .map(
                        (item) => `<tr>
                          <td><strong>${escapeHtml(item.title)}</strong></td>
                          <td>${escapeHtml(item.channel)}</td>
                          <td>${escapeHtml(item.value)}</td>
                          <td>${escapeHtml(item.note)}</td>
                        </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            </section>`
          : ""
      }

      <section>
        <h2>Idea Directions</h2>
        <div class="grid ideas">
          ${report.ideaDirections
            .map(
              (idea) => `<article class="card">
                <div class="idea-title">${escapeHtml(idea.title)}</div>
                <div class="idea-meta">Why Now</div>
                ${renderParagraphs(idea.whyNow)}
                <div class="idea-meta">Evidence</div>
                ${renderParagraphs(idea.evidence)}
              </article>`
            )
            .join("")}
        </div>
      </section>

      <div class="footer">
        ${escapeHtml(report.footerNote)}<br />
        Scope: ${escapeHtml(run.scopeType)} · Window: ${escapeHtml(run.scopeStartDate)} to ${escapeHtml(
          run.scopeEndDate
        )}
      </div>
    </main>
  </body>
</html>`;
}
