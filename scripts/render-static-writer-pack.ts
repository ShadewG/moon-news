import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type WriterPack = {
  meta: {
    title: string;
    slug: string;
    generatedAt: string;
  };
  topSummary: {
    shortSummary: string;
    storyPoints: string[];
  };
  insaneClips: Array<{
    title: string;
    sourceUrl: string;
    provider: string;
    channelOrContributor: string | null;
    talkingPointCount: number;
    visualUrl?: string | null;
    visualKind?: string | null;
  }>;
  tiktokClips?: Array<{
    title: string;
    sourceUrl: string;
    provider: string;
    channelOrContributor: string | null;
    transcriptSegments: number;
    talkingPointCount: number;
    discoveryQuery: string;
    primaryQuote: string | null;
    visualUrl?: string | null;
  }>;
  importantQuotes: Array<{
    sourceTitle: string;
    sourceUrl: string | null;
    quoteText: string;
    provenance: string;
    visualUrl?: string | null;
    visualKind?: string | null;
  }>;
  audienceReaction: Array<{
    title: string;
    url: string;
    snippet: string;
    visualUrl?: string | null;
    visualKind?: string | null;
  }>;
  articleReceipts: Array<{
    title: string;
    url: string;
    source: string;
    snippet: string;
  }>;
  queues: {
    missingTranscriptQueue: Array<{ title: string; sourceUrl: string; reason: string }>;
    unsupportedSourceQueue: Array<{ title: string; sourceUrl: string; reason: string }>;
    transcriptedNoTalkingPoints: Array<{ title: string; sourceUrl: string }>;
  };
};

function escapeHtml(value: string | null | undefined) {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url, "https://moon-internal.xyz").toString();
  } catch {
    return url;
  }
}

function renderCard(args: {
  title: string;
  href: string | null;
  meta?: string | null;
  body?: string | null;
  image?: string | null;
  quote?: string | null;
}) {
  const image = args.image ? `<img src="${escapeHtml(args.image)}" alt="${escapeHtml(args.title)}" loading="lazy" />` : "";
  const title = args.href
    ? `<a href="${escapeHtml(args.href)}" target="_blank" rel="noreferrer">${escapeHtml(args.title)}</a>`
    : `<div class="card-title">${escapeHtml(args.title)}</div>`;
  const meta = args.meta ? `<div class="meta">${escapeHtml(args.meta)}</div>` : "";
  const body = args.body ? `<div class="body">${escapeHtml(args.body)}</div>` : "";
  const quote = args.quote ? `<blockquote>${escapeHtml(args.quote)}</blockquote>` : "";
  return `<article class="card">${image}${title}${meta}${quote}${body}</article>`;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    throw new Error("Usage: tsx scripts/render-static-writer-pack.ts <slug>");
  }

  const inputPath = path.resolve(process.cwd(), "research", `writer-pack-${slug}.json`);
  const report = JSON.parse(await readFile(inputPath, "utf8")) as WriterPack;

  const extraSources = [
    ...report.queues.transcriptedNoTalkingPoints.map((item) => ({
      title: item.title,
      url: item.sourceUrl,
      reason: "Transcripted, but no top talking point survived.",
    })),
    ...report.queues.unsupportedSourceQueue.map((item) => ({
      title: item.title,
      url: item.sourceUrl,
      reason: item.reason,
    })),
    ...report.queues.missingTranscriptQueue.map((item) => ({
      title: item.title,
      url: item.sourceUrl,
      reason: item.reason,
    })),
  ];

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(report.meta.title)} | Writer Pack</title>
  <style>
    :root {
      --bg: #0c1117;
      --panel: #121923;
      --panel-2: #18212d;
      --text: #edf2f7;
      --muted: #9fb0c4;
      --border: rgba(255,255,255,0.1);
      --accent: #78b8ff;
      --accent-2: #f7a04a;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: linear-gradient(180deg, #0c1117, #111827 50%, #0d131a); color: var(--text); }
    a { color: var(--text); text-decoration-color: rgba(120,184,255,.35); text-underline-offset: 2px; }
    main { max-width: 1480px; margin: 0 auto; padding: 32px 24px 80px; }
    header, section { background: var(--panel); border: 1px solid var(--border); border-radius: 24px; padding: 24px; margin-bottom: 24px; }
    h1, h2 { margin: 0; }
    h1 { font-size: 40px; line-height: 1.08; }
    h2 { font-size: 28px; margin-bottom: 18px; }
    .eyebrow, .meta { color: var(--muted); font-size: 12px; letter-spacing: .14em; text-transform: uppercase; }
    .summary-grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 20px; }
    .story-points { display: grid; gap: 10px; }
    .story-point { background: var(--panel-2); border: 1px solid var(--border); border-radius: 16px; padding: 12px 14px; line-height: 1.6; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .card { background: var(--panel-2); border: 1px solid var(--border); border-radius: 18px; padding: 16px; }
    .card img { width: 100%; border-radius: 12px; margin-bottom: 12px; display: block; object-fit: cover; max-height: 420px; }
    .card > a, .card-title { display: block; font-weight: 600; line-height: 1.5; }
    .body { margin-top: 10px; line-height: 1.65; color: var(--muted); }
    blockquote { margin: 12px 0 0; border-left: 3px solid var(--accent-2); padding-left: 12px; line-height: 1.7; color: var(--text); }
    .quote-grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 20px; }
    @media (max-width: 1100px) {
      .summary-grid, .quote-grid, .grid, .grid.two { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="eyebrow">Writer Pack</div>
      <h1>${escapeHtml(report.meta.title)}</h1>
    </header>

    <section class="summary-grid">
      <div>
        <div class="eyebrow">Short Summary</div>
        <p style="font-size:18px;line-height:1.8;margin:16px 0 0;">${escapeHtml(report.topSummary.shortSummary)}</p>
      </div>
      <div>
        <div class="eyebrow">Crazy Story Points</div>
        <div class="story-points" style="margin-top:14px;">
          ${report.topSummary.storyPoints.slice(0, 10).map((point) => `<div class="story-point">${escapeHtml(point)}</div>`).join("")}
        </div>
      </div>
    </section>

    <section>
      <div class="eyebrow">Key Viral Clips</div>
      <h2>The clips you probably want in the edit</h2>
      <div class="grid">
        ${report.insaneClips.slice(0, 12).map((clip) =>
          renderCard({
            title: clip.title,
            href: normalizeUrl(clip.sourceUrl),
            meta: [clip.provider, clip.channelOrContributor, clip.talkingPointCount ? `${clip.talkingPointCount} points` : null].filter(Boolean).join(" · "),
            image: normalizeUrl(clip.visualUrl ?? null),
          })
        ).join("")}
      </div>
    </section>

    ${report.tiktokClips && report.tiktokClips.length > 0 ? `
    <section>
      <div class="eyebrow">TikTok Lane</div>
      <h2>Viral TikToks worth checking</h2>
      <div class="grid">
        ${report.tiktokClips.map((clip) =>
          renderCard({
            title: clip.title,
            href: normalizeUrl(clip.sourceUrl),
            meta: [clip.provider, clip.channelOrContributor, `${clip.talkingPointCount} points`, `query: ${clip.discoveryQuery}`].filter(Boolean).join(" · "),
            image: normalizeUrl(clip.visualUrl ?? null),
            quote: clip.primaryQuote,
          })
        ).join("")}
      </div>
    </section>` : ""}

    <section class="quote-grid">
      <div>
        <div class="eyebrow">Important Quotes</div>
        <h2>The lines worth building around</h2>
        <div class="grid two">
          ${report.importantQuotes.slice(0, 18).map((quote) =>
            renderCard({
              title: quote.sourceTitle,
              href: normalizeUrl(quote.sourceUrl),
              meta: quote.provenance.replace(/_/g, " "),
              image: normalizeUrl(quote.visualUrl ?? null),
              quote: quote.quoteText,
            })
          ).join("")}
        </div>
      </div>
      <div>
        <div class="eyebrow">Audience Reaction</div>
        <h2>Tweets and public reaction</h2>
        <div class="story-points">
          ${report.audienceReaction.map((item) =>
            renderCard({
              title: item.title,
              href: normalizeUrl(item.url),
              body: item.snippet,
              image: normalizeUrl(item.visualUrl ?? null),
            })
          ).join("")}
        </div>
      </div>
    </section>

    <section>
      <div class="eyebrow">Article Receipts</div>
      <h2>Hard reporting to cite</h2>
      <div class="grid">
        ${report.articleReceipts.map((item) =>
          renderCard({
            title: item.title,
            href: normalizeUrl(item.url),
            meta: item.source,
            body: item.snippet,
          })
        ).join("")}
      </div>
    </section>

    ${extraSources.length > 0 ? `
    <section>
      <div class="eyebrow">Extra Sources</div>
      <h2>Everything else worth keeping around</h2>
      <div class="grid">
        ${extraSources.slice(0, 24).map((item) =>
          renderCard({
            title: item.title,
            href: normalizeUrl(item.url),
            body: item.reason,
          })
        ).join("")}
      </div>
    </section>` : ""}
  </main>
</body>
</html>`;

  const outputDir = path.resolve(process.cwd(), "public", "research", "writer-packets", slug);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "index.html"), html, "utf8");

  console.log(
    JSON.stringify(
      {
        outputDir,
        outputFile: path.join(outputDir, "index.html"),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
