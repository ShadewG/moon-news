import { config } from "dotenv";
import Module from "node:module";

config({ path: ".env.local", override: false });
config({ path: ".env", override: false });

type ModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

const moduleLoader = Module as ModuleLoader;
const originalLoad = moduleLoader._load;
moduleLoader._load = function patchedLoad(
  request: string,
  parent: NodeModule | null,
  isMain: boolean
) {
  if (request === "server-only") {
    return {};
  }

  return originalLoad.call(this, request, parent, isMain);
};

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { desc, eq, gte, sql } from "drizzle-orm";

import { getDb } from "../src/server/db/client";
import {
  boardFeedItems,
  boardSources,
  boardStoryCandidates,
  boardStorySources,
} from "../src/server/db/schema";
import { scoreStory } from "../src/server/services/board/story-scorer";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonRecord;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function decodeHtml(value: string | null | undefined): string {
  if (!value) return "n/a";

  const namedEntities: Record<string, string> = {
    "&amp;": "&",
    "&apos;": "'",
    "&quot;": '"',
    "&hellip;": "...",
    "&#8230;": "...",
    "&#8216;": "'",
    "&#8217;": "'",
    "&#8220;": '"',
    "&#8221;": '"',
    "&#039;": "'",
    "&#39;": "'",
  };

  return value
    .replace(/&[a-z#0-9]+;/gi, (match) => {
      if (namedEntities[match]) {
        return namedEntities[match];
      }

      const decimal = match.match(/^&#(\d+);$/);
      if (decimal) {
        const codePoint = Number(decimal[1]);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }

      const hex = match.match(/^&#x([0-9a-f]+);$/i);
      if (hex) {
        const codePoint = Number.parseInt(hex[1], 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }

      return match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "n/a";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "n/a" : date.toISOString();
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  return digits > 0 ? value.toFixed(digits) : String(Math.round(value));
}

function computeAgePenaltyMultiplier(lastSeenAt: Date | null): number {
  if (!lastSeenAt) return 1;

  const ageMs = Date.now() - lastSeenAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const ageDays = ageHours / 24;

  if (ageDays > 30) return 0.2;
  if (ageDays > 14) return 0.4;
  if (ageDays > 7) return 0.6;
  if (ageDays > 3) return 0.8;
  return 1;
}

function computeRelevanceMultiplier(args: {
  boardVisibilityScore: number | null;
  moonRelevance: number | null;
}): string {
  if (args.boardVisibilityScore !== null) {
    if (args.boardVisibilityScore >= 80) return "1.00 (AI visibility band)";
    if (args.boardVisibilityScore >= 60) return "0.75 (AI visibility band)";
    if (args.boardVisibilityScore >= 45) return "0.50 (AI visibility band)";
    if (args.boardVisibilityScore >= 30) return "0.25 (AI visibility band)";
    return "0.10 (AI visibility band)";
  }

  if (args.moonRelevance === null) {
    return "n/a (AI visibility missing and fallback keyword gate not reconstructed)";
  }

  if (args.moonRelevance >= 70) return "1.00 (fallback moon relevance)";
  if (args.moonRelevance >= 55) return "0.70 (fallback moon relevance)";
  if (args.moonRelevance >= 40) return "0.40 (fallback moon relevance)";
  return "0.08 (fallback moon relevance)";
}

function renderList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "none";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildHtmlFromMarkdown(input: {
  markdown: string;
  sampleSize: number;
  hours: number;
  generatedAt: string;
  model: string;
}) {
  const lines = input.markdown.split("\n");
  const introLines: string[] = [];
  const storySections: Array<{ title: string; slug: string; body: string }> = [];
  let currentSection: { title: string; slug: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentSection) {
        storySections.push({
          title: currentSection.title,
          slug: currentSection.slug,
          body: currentSection.lines.join("\n").trim(),
        });
      }

      const title = line.slice(3).trim();
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      currentSection = { title, slug, lines: [] };
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      introLines.push(line);
    }
  }

  if (currentSection) {
    storySections.push({
      title: currentSection.title,
      slug: currentSection.slug,
      body: currentSection.lines.join("\n").trim(),
    });
  }

  const toc = storySections.map(({ title, slug }) => ({ title, slug }));

  const tocHtml = toc
    .map(
      (entry) =>
        `<li><a href="#${entry.slug}">${escapeHtml(entry.title)}</a></li>`
    )
    .join("");

  const storyHtml = storySections
    .map(
      (section) => `
          <section class="story" id="${section.slug}">
            <h2>${escapeHtml(section.title)}</h2>
            <pre>${escapeHtml(section.body)}</pre>
          </section>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Board Score Sample</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0a0a0f;
        --panel: #12121a;
        --panel-2: #171722;
        --border: #2a2a3a;
        --text: #f0f0f5;
        --muted: #9ea0b5;
        --accent: #67d1ff;
        --accent-2: #8effc1;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background:
          radial-gradient(circle at top left, rgba(103, 209, 255, 0.08), transparent 32%),
          radial-gradient(circle at top right, rgba(142, 255, 193, 0.06), transparent 28%),
          var(--bg);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
      .page {
        width: min(1440px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 24px 0 48px;
      }
      .hero {
        background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015));
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 24px;
        margin-bottom: 18px;
      }
      .eyebrow {
        color: var(--accent-2);
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        margin-bottom: 10px;
      }
      h1 {
        margin: 0 0 10px;
        font-size: clamp(28px, 4vw, 44px);
        line-height: 1.04;
      }
      .meta {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        color: var(--muted);
        font-size: 14px;
      }
      .layout {
        display: grid;
        grid-template-columns: 320px minmax(0, 1fr);
        gap: 18px;
        align-items: start;
      }
      .panel {
        background: rgba(18, 18, 26, 0.84);
        border: 1px solid var(--border);
        border-radius: 18px;
      }
      .toc {
        position: sticky;
        top: 16px;
        max-height: calc(100vh - 32px);
        overflow: auto;
        padding: 18px 18px 20px;
      }
      .toc h2 {
        margin: 0 0 10px;
        font-size: 14px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .toc ol {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 8px;
        font-size: 13px;
        line-height: 1.35;
      }
      .doc {
        overflow: auto;
        padding: 18px;
      }
      .doc-intro {
        margin-bottom: 18px;
        border: 1px solid var(--border);
        border-radius: 16px;
        background: rgba(255,255,255,0.015);
      }
      .story {
        border: 1px solid var(--border);
        border-radius: 18px;
        background: rgba(255,255,255,0.015);
        margin-bottom: 18px;
        scroll-margin-top: 16px;
      }
      .story h2 {
        margin: 0;
        padding: 18px 20px 0;
        font-size: 18px;
        line-height: 1.3;
      }
      pre {
        margin: 0;
        padding: 20px;
        white-space: pre-wrap;
        word-break: break-word;
        font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        color: var(--text);
      }
      .top-link {
        position: fixed;
        right: 18px;
        bottom: 18px;
        background: rgba(18, 18, 26, 0.92);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 10px 14px;
      }
      @media (max-width: 1100px) {
        .layout {
          grid-template-columns: 1fr;
        }
        .toc {
          position: static;
          max-height: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="page" id="top">
      <section class="hero">
        <div class="eyebrow">Moon Internal</div>
        <h1>Board Score Sample</h1>
        <div class="meta">
          <span>${input.sampleSize} random stories</span>
          <span>Last ${input.hours} hours</span>
          <span>Generated ${escapeHtml(input.generatedAt)}</span>
          <span>Model ${escapeHtml(input.model)}</span>
        </div>
      </section>
      <div class="layout">
        <aside class="panel toc">
          <h2>Stories</h2>
          <ol>${tocHtml}</ol>
        </aside>
        <main class="panel doc">
          <section class="doc-intro">
            <pre>${escapeHtml(introLines.join("\n").trim())}</pre>
          </section>
${storyHtml}
        </main>
      </div>
    </div>
    <a class="top-link" href="#top">Back to top</a>
  </body>
</html>`;
}

async function main() {
  const countArg = process.argv.find((arg) => arg.startsWith("--count="));
  const hoursArg = process.argv.find((arg) => arg.startsWith("--hours="));
  const fromMarkdownArg = process.argv.find((arg) => arg.startsWith("--from-markdown="));
  const count = Math.max(1, Math.min(200, Number(countArg?.split("=")[1] ?? "100") || 100));
  const hours = Math.max(1, Number(hoursArg?.split("=")[1] ?? "72") || 72);
  const fromMarkdown = fromMarkdownArg?.slice("--from-markdown=".length) ?? null;
  const reportDate = new Date().toISOString().slice(0, 10);

  if (fromMarkdown) {
    const sourceMarkdownPath = path.resolve(process.cwd(), fromMarkdown);
    const markdown = await readFile(sourceMarkdownPath, "utf8");
    const outputHtmlPath = path.resolve(
      process.cwd(),
      "public",
      "reports",
      path.basename(sourceMarkdownPath, ".md") + ".html"
    );
    const html = buildHtmlFromMarkdown({
      markdown,
      sampleSize: count,
      hours,
      generatedAt: new Date().toISOString(),
      model: process.env.OPENAI_RESEARCH_MODEL ?? "gpt-4.1-mini",
    });

    await mkdir(path.dirname(outputHtmlPath), { recursive: true });
    await writeFile(outputHtmlPath, html, "utf8");
    console.log(`Wrote ${outputHtmlPath}`);
    return;
  }

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const db = getDb();

  const sampledStories = await db
    .select({
      id: boardStoryCandidates.id,
      canonicalTitle: boardStoryCandidates.canonicalTitle,
      lastSeenAt: boardStoryCandidates.lastSeenAt,
    })
    .from(boardStoryCandidates)
    .where(gte(boardStoryCandidates.lastSeenAt, cutoff))
    .orderBy(sql`random()`)
    .limit(count);

  if (sampledStories.length === 0) {
    throw new Error(`No board stories found with last_seen_at in the last ${hours} hours.`);
  }

  const sections: string[] = [];
  const generatedAt = new Date().toISOString();

  for (const [index, sampled] of sampledStories.entries()) {
    console.log(`[${index + 1}/${sampledStories.length}] scoring ${sampled.id} :: ${sampled.canonicalTitle}`);

    await scoreStory(sampled.id);

    const story = await db
      .select()
      .from(boardStoryCandidates)
      .where(eq(boardStoryCandidates.id, sampled.id))
      .limit(1)
      .then((rows) => rows[0]);

    if (!story) {
      sections.push(`## ${sampled.canonicalTitle}\n\nStory row was missing after scoring.\n`);
      continue;
    }

    const linkedSources = await db
      .select({
        sourceName: boardSources.name,
        sourceKind: boardSources.kind,
        sourceUrl: boardFeedItems.url,
        title: boardFeedItems.title,
        summary: boardFeedItems.summary,
        publishedAt: boardFeedItems.publishedAt,
        ingestedAt: boardFeedItems.ingestedAt,
        isPrimary: boardStorySources.isPrimary,
      })
      .from(boardStorySources)
      .innerJoin(boardFeedItems, eq(boardStorySources.feedItemId, boardFeedItems.id))
      .innerJoin(boardSources, eq(boardFeedItems.sourceId, boardSources.id))
      .where(eq(boardStorySources.storyId, sampled.id))
      .orderBy(
        desc(boardStorySources.isPrimary),
        desc(boardFeedItems.publishedAt),
        desc(boardFeedItems.ingestedAt)
      )
      .limit(5);

    const scoreJson = asRecord(story.scoreJson);
    const aiAssessment = asRecord(scoreJson.aiBoardAssessment);
    const sourceScore = asNumber(scoreJson.sourceScore) ?? 0;
    const controversyScore = asNumber(scoreJson.controversyScore) ?? 0;
    const timelinessScore = asNumber(scoreJson.timelinessScore) ?? 0;
    const competitorOverlap = asNumber(scoreJson.competitorOverlap) ?? 0;
    const visualEvidence = asNumber(scoreJson.visualEvidence) ?? 0;
    const moonRelevance = asNumber(scoreJson.moonRelevance);
    const rawTotal =
      sourceScore + controversyScore + timelinessScore + competitorOverlap + visualEvidence;
    const boardVisibilityScore = asNumber(scoreJson.boardVisibilityScore);
    const agePenaltyMultiplier = computeAgePenaltyMultiplier(story.lastSeenAt);
    const relevanceMultiplier = computeRelevanceMultiplier({
      boardVisibilityScore,
      moonRelevance,
    });
    const surgeActive = asBoolean(scoreJson.surgeActive) ?? false;
    const sourceBase = Math.min(story.sourcesCount * 3, 30);

    const sourceLines =
      linkedSources.length > 0
        ? linkedSources
            .map((source, sourceIndex) => {
              const summary = source.summary?.trim() ? decodeHtml(source.summary.trim()) : "n/a";
              return [
                `${sourceIndex + 1}. ${source.sourceName} [${source.sourceKind}]${source.isPrimary ? " primary" : ""}`,
                `   Headline: ${decodeHtml(source.title)}`,
                `   Published: ${formatDate(source.publishedAt)}`,
                `   Ingested: ${formatDate(source.ingestedAt)}`,
                `   URL: ${source.sourceUrl}`,
                `   Summary: ${summary}`,
              ].join("\n");
            })
            .join("\n\n")
        : "No linked sources found.";

    sections.push(
      [
        `## ${decodeHtml(story.canonicalTitle)}`,
        "",
        `- Story ID: \`${story.id}\``,
        `- Final score: \`${story.surgeScore}\``,
        `- Tier: \`${asString(scoreJson.tier) ?? "n/a"}\``,
        `- Story type: \`${story.storyType}\``,
        `- Status: \`${story.status}\``,
        `- Vertical: \`${story.vertical ?? "unknown"}\``,
        `- Sentiment score: \`${formatNumber(story.sentimentScore, 2)}\``,
        `- Persisted controversy score: \`${story.controversyScore}\``,
        `- Sources / items: \`${story.sourcesCount}\` / \`${story.itemsCount}\``,
        `- First seen: \`${formatDate(story.firstSeenAt)}\``,
        `- Last seen: \`${formatDate(story.lastSeenAt)}\``,
        `- Last scored: \`${asString(scoreJson.lastScoredAt) ?? "n/a"}\``,
        "",
        `### Score Math`,
        "",
        `- Raw total before multipliers: \`${rawTotal}\``,
        `- Source score: \`${sourceScore}\``,
        `- Controversy score: \`${controversyScore}\``,
        `- Timeliness score: \`${timelinessScore}\``,
        `- Competitor overlap: \`${competitorOverlap}\``,
        `- Visual evidence: \`${visualEvidence}\``,
        `- Moon relevance: \`${formatNumber(moonRelevance)}\``,
        `- Source base before tier-1 bonus: \`${sourceBase}\``,
        `- Tier-1 bonus inferred: \`${sourceScore > sourceBase ? "yes" : "no"}\``,
        `- Board visibility score: \`${formatNumber(boardVisibilityScore)}\``,
        `- Relevance multiplier: \`${relevanceMultiplier}\``,
        `- Age penalty multiplier: \`${agePenaltyMultiplier.toFixed(2)}\``,
        `- Surge active: \`${surgeActive}\``,
        "",
        `### AI Assessment`,
        "",
        `- Model: \`${asString(aiAssessment.model) ?? "n/a"}\``,
        `- Prompt version: \`${asString(aiAssessment.promptVersion) ?? "n/a"}\``,
        `- Computed at: \`${asString(aiAssessment.computedAt) ?? "n/a"}\``,
        `- Suggested story type: \`${asString(aiAssessment.suggestedStoryType) ?? "n/a"}\``,
        `- AI board visibility: \`${formatNumber(asNumber(aiAssessment.boardVisibilityScore))}\``,
        `- AI moon fit: \`${formatNumber(asNumber(aiAssessment.moonFitScore))}\``,
        `- AI controversy: \`${formatNumber(asNumber(aiAssessment.controversyScore))}\``,
        `- Confidence: \`${formatNumber(asNumber(aiAssessment.confidence))}\``,
        `- Explanation: ${asString(aiAssessment.explanation) ?? "n/a"}`,
        "",
        `### Moon Signals`,
        "",
        `- Moon fit score: \`${formatNumber(asNumber(scoreJson.moonFitScore))}\``,
        `- Moon fit band: \`${asString(scoreJson.moonFitBand) ?? "n/a"}\``,
        `- Moon cluster: \`${asString(scoreJson.moonCluster) ?? "n/a"}\``,
        `- Coverage mode: \`${asString(scoreJson.coverageMode) ?? "n/a"}\``,
        `- Reason codes: ${renderList(asStringArray(scoreJson.reasonCodes))}`,
        `- Analog titles: ${renderList(asStringArray(scoreJson.analogTitles))}`,
        "",
        `### Linked Source Evidence`,
        "",
        sourceLines,
        "",
        `### Raw score_json`,
        "",
        "```json",
        JSON.stringify(scoreJson, null, 2),
        "```",
        "",
      ].join("\n")
    );
  }

  const report = [
    "# Board Score Sample",
    "",
    `- Generated at: \`${generatedAt}\``,
    `- Sample size: \`${sampledStories.length}\` random stories`,
    `- Sampling window: stories with \`last_seen_at\` in the last \`${hours}\` hours`,
    `- Scoring path: current board scorer via \`scoreStory()\`, including AI board assessment when available`,
    `- Model env: \`${process.env.OPENAI_RESEARCH_MODEL ?? "gpt-4.1-mini"}\``,
    "",
    sections.join("\n"),
  ].join("\n");

  const outputPath = path.resolve(
    process.cwd(),
    "research",
    `board-score-sample-${reportDate}-random-${sampledStories.length}.md`
  );
  const htmlPath = path.resolve(
    process.cwd(),
    "public",
    "reports",
    `board-score-sample-${reportDate}-random-${sampledStories.length}.html`
  );
  const html = buildHtmlFromMarkdown({
    markdown: report,
    sampleSize: sampledStories.length,
    hours,
    generatedAt,
    model: process.env.OPENAI_RESEARCH_MODEL ?? "gpt-4.1-mini",
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(htmlPath), { recursive: true });
  await writeFile(outputPath, report, "utf8");
  await writeFile(htmlPath, html, "utf8");

  console.log(`\nWrote ${outputPath}`);
  console.log(`Wrote ${htmlPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
