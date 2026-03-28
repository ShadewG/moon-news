import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type HeadlineEvalReport = {
  slug: string;
  title: string;
  generatedAt: string;
  evaluationRunId: string;
  request: {
    storyTitle: string;
    researchDepth: string;
    targetRuntimeMinutes: number;
  };
  planResearchStage: {
    broadResearchProvider: string;
    broadResearchModel: string;
    broadResearch: {
      factualOverview: string;
      originPremise: string;
      tensions: string[];
      broaderSystem: string;
      runwayBeats: string[];
      turningPoints: string[];
      stakeShifters: string[];
      resolutionMechanism: string;
      keyFacts: Array<{
        fact: string;
        sourceLabel: string;
        url?: string | null;
        confidence: string;
      }>;
    };
    researchStrategyModel: string;
    researchStrategy: {
      primaryAngle: string;
      hookIdea: string;
      storyType: string;
      videoStructure: Array<{
        sectionId: string;
        title: string;
        purpose: string;
        whyItMatters: string;
        targetWordCount: number;
      }>;
    };
    sectionQueryPlanningModel: string;
  };
  synthesizeResearchStage: {
    thesis: string;
    keyClaims: string[];
    riskyClaims: string[];
  };
  outlineStage: {
    sections: Array<{
      heading: string;
      purpose: string;
      beatGoal: string;
    }>;
  };
  metrics: {
    totalSources: number;
    transcriptSources: number;
    transcriptSourcesComplete: number;
    transcriptSourcesPending: number;
    transcriptQuoteCount: number;
    documentQuoteCount: number;
  };
  transcriptSources: Array<{
    stageKey: string | null;
    sourceKind: string;
    providerName: string;
    title: string;
    url: string | null;
    contentStatus: string;
    transcriptStatus: string;
  }>;
  transcriptQuotes: Array<{
    sourceLabel: string;
    sourceUrl: string | null;
    quoteText: string;
    speaker: string | null;
    context: string | null;
    startMs: number | null;
    relevanceScore: number;
  }>;
  documentQuotes: Array<{
    sourceLabel: string;
    sourceUrl: string | null;
    quoteText: string;
    speaker: string | null;
    context: string | null;
    relevanceScore: number;
  }>;
};

async function loadReport(slug: string) {
  const filePath = path.resolve(process.cwd(), "research", `headline-eval-${slug}.json`);

  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as HeadlineEvalReport;
  } catch {
    notFound();
  }
}

function chip(label: string) {
  return (
    <span
      key={label}
      style={{
        display: "inline-block",
        padding: "6px 10px",
        borderRadius: 999,
        background: "rgba(28, 31, 52, 0.08)",
        color: "#1c1f34",
        fontSize: 13,
        lineHeight: 1.3,
        marginRight: 8,
        marginBottom: 8,
      }}
    >
      {label}
    </span>
  );
}

function sectionCard(title: string, children: React.ReactNode) {
  return (
    <section
      style={{
        border: "1px solid rgba(28, 31, 52, 0.12)",
        borderRadius: 22,
        background: "rgba(255,255,255,0.84)",
        boxShadow: "0 16px 40px rgba(37, 40, 74, 0.08)",
        padding: 24,
      }}
    >
      <h2 style={{ margin: "0 0 16px", fontSize: 24, lineHeight: 1.1 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function formatTimestamp(startMs: number | null | undefined) {
  if (typeof startMs !== "number" || startMs < 0) {
    return null;
  }

  const totalSeconds = Math.floor(startMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default async function HeadlineEvalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const report = await loadReport(slug);

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(147, 175, 255, 0.24), transparent 34%), linear-gradient(180deg, #f5f6fb 0%, #e8ebf7 100%)",
        color: "#1b2037",
        padding: "40px 20px 80px",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header style={{ marginBottom: 28 }}>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#68708d",
            }}
          >
            Moon Internal
          </p>
          <h1
            style={{
              margin: "12px 0 8px",
              fontSize: "clamp(2rem, 3.1vw, 3.5rem)",
              lineHeight: 1.02,
            }}
          >
            {report.title} Research Review
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: 860,
              fontSize: 16,
              lineHeight: 1.55,
              color: "#4a5270",
            }}
          >
            Headline-only evaluation showing the broad research, Claude plan,
            synthesized thesis, outline, and the transcript-backed quotes the
            stack actually found.
          </p>
          <div style={{ marginTop: 14 }}>
            {chip(`Broad research: ${report.planResearchStage.broadResearchProvider} / ${report.planResearchStage.broadResearchModel}`)}
            {chip(`Strategy: ${report.planResearchStage.researchStrategyModel}`)}
            {chip(`Query planner: ${report.planResearchStage.sectionQueryPlanningModel}`)}
            {chip(`Run ID: ${report.evaluationRunId}`)}
          </div>
          <div style={{ marginTop: 12 }}>
            {chip(`Transcript sources: ${report.metrics.transcriptSources}`)}
            {chip(`Transcript complete: ${report.metrics.transcriptSourcesComplete}`)}
            {chip(`Transcript pending/failed: ${report.metrics.transcriptSourcesPending}`)}
            {chip(`Transcript quotes: ${report.metrics.transcriptQuoteCount}`)}
            {chip(`Document quotes: ${report.metrics.documentQuoteCount}`)}
          </div>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.05fr 0.95fr",
            gap: 20,
          }}
        >
          <div style={{ display: "grid", gap: 20 }}>
            {sectionCard(
              "Broad Research",
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <strong>Overview</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.planResearchStage.broadResearch.factualOverview}
                  </p>
                </div>
                <div>
                  <strong>Origin premise</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.planResearchStage.broadResearch.originPremise}
                  </p>
                </div>
                <div>
                  <strong>Broader system</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.planResearchStage.broadResearch.broaderSystem}
                  </p>
                </div>
                <div>
                  <strong>Tensions</strong>
                  <div style={{ marginTop: 8 }}>
                    {report.planResearchStage.broadResearch.tensions.map(chip)}
                  </div>
                </div>
                <div>
                  <strong>Turning points</strong>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
                    {report.planResearchStage.broadResearch.turningPoints.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Key facts</strong>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
                    {report.planResearchStage.broadResearch.keyFacts.map((fact, index) => (
                      <li key={`${fact.fact}-${index}`}>
                        {fact.fact}
                        <div style={{ fontSize: 13, color: "#5c647f" }}>
                          {fact.sourceLabel}
                          {fact.url ? (
                            <>
                              {" "}
                              ·{" "}
                              <a href={fact.url} target="_blank" rel="noreferrer">
                                source
                              </a>
                            </>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {sectionCard(
              "Claude Plan And Outline",
              <div style={{ display: "grid", gap: 18 }}>
                <div>
                  <strong>Primary angle</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.planResearchStage.researchStrategy.primaryAngle}
                  </p>
                </div>
                <div>
                  <strong>Hook</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.planResearchStage.researchStrategy.hookIdea}
                  </p>
                </div>
                <div>
                  <strong>Thesis</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.synthesizeResearchStage.thesis}
                  </p>
                </div>
                <div>
                  <strong>Key claims</strong>
                  <div style={{ marginTop: 8 }}>
                    {report.synthesizeResearchStage.keyClaims.map(chip)}
                  </div>
                </div>
                <div>
                  <strong>Outline</strong>
                  <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
                    {report.outlineStage.sections.map((section, index) => (
                      <article
                        key={`${section.heading}-${index}`}
                        style={{
                          padding: 14,
                          borderRadius: 16,
                          background: "rgba(28, 31, 52, 0.04)",
                        }}
                      >
                        <div style={{ fontSize: 12, color: "#69718d", marginBottom: 6 }}>
                          Section {index + 1}
                        </div>
                        <div style={{ fontWeight: 700 }}>{section.heading}</div>
                        <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>
                          <strong>Purpose:</strong> {section.purpose}
                        </p>
                        <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>
                          <strong>Beat goal:</strong> {section.beatGoal}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            {sectionCard(
              "Transcript Quotes",
              report.transcriptQuotes.length > 0 ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {report.transcriptQuotes.map((quote, index) => (
                    <article
                      key={`${quote.sourceLabel}-${quote.startMs}-${index}`}
                      style={{
                        padding: 14,
                        borderRadius: 16,
                        background: "rgba(28, 31, 52, 0.04)",
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#69718d", marginBottom: 6 }}>
                        {quote.sourceLabel}
                        {typeof quote.startMs === "number"
                          ? ` · ${formatTimestamp(quote.startMs)}`
                          : ""}
                        {` · ${(quote.relevanceScore * 100).toFixed(0)}%`}
                      </div>
                      <div style={{ lineHeight: 1.55 }}>{quote.quoteText}</div>
                      {quote.context ? (
                        <div style={{ marginTop: 8, fontSize: 13, color: "#5c647f" }}>
                          {quote.context}
                        </div>
                      ) : null}
                      {quote.sourceUrl ? (
                        <div style={{ marginTop: 8, fontSize: 13 }}>
                          <a href={quote.sourceUrl} target="_blank" rel="noreferrer">
                            Open source
                          </a>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, lineHeight: 1.6 }}>
                  No transcript-backed quotes were captured in this run. Check the
                  transcript source status below to see whether discovery was thin
                  or media transcription failed on this host.
                </p>
              )
            )}

            {sectionCard(
              "Transcript Source Status",
              <div style={{ display: "grid", gap: 12 }}>
                {report.transcriptSources.map((source, index) => (
                  <article
                    key={`${source.title}-${index}`}
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      background: "rgba(28, 31, 52, 0.04)",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "#69718d", marginBottom: 6 }}>
                      {source.stageKey ?? "none"} · {source.sourceKind} · {source.providerName}
                    </div>
                    <div style={{ fontWeight: 700 }}>{source.title}</div>
                    <div style={{ marginTop: 8, fontSize: 13, color: "#5c647f" }}>
                      content={source.contentStatus} · transcript={source.transcriptStatus}
                    </div>
                    {source.url ? (
                      <div style={{ marginTop: 8, fontSize: 13 }}>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          Open source
                        </a>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}

            {sectionCard(
              "Document Quotes",
              report.documentQuotes.length > 0 ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {report.documentQuotes.map((quote, index) => (
                    <article
                      key={`${quote.sourceLabel}-${index}`}
                      style={{
                        padding: 14,
                        borderRadius: 16,
                        background: "rgba(28, 31, 52, 0.04)",
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#69718d", marginBottom: 6 }}>
                        {quote.sourceLabel} · {(quote.relevanceScore * 100).toFixed(0)}%
                      </div>
                      <div style={{ lineHeight: 1.55 }}>{quote.quoteText}</div>
                      {quote.context ? (
                        <div style={{ marginTop: 8, fontSize: 13, color: "#5c647f" }}>
                          {quote.context}
                        </div>
                      ) : null}
                      {quote.sourceUrl ? (
                        <div style={{ marginTop: 8, fontSize: 13 }}>
                          <a href={quote.sourceUrl} target="_blank" rel="noreferrer">
                            Open source
                          </a>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0 }}>No document quotes saved for this run.</p>
              )
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
