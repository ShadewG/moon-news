import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

type DebugPlanReport = {
  clipId: string;
  title: string;
  sourceUrl: string;
  broadResearchProvider: string;
  broadResearchModel: string;
  broadResearch: {
    factualOverview: string;
    originPremise: string;
    keyFacts: Array<{
      fact: string;
      sourceLabel: string;
      url?: string | null;
      confidence: string;
    }>;
    tensions: string[];
    broaderSystem: string;
    runwayBeats: string[];
    turningPoints: string[];
    stakeShifters: string[];
    resolutionMechanism: string;
    openQuestions: string[];
    sectionCandidates: Array<{
      title: string;
      whyItMatters: string;
    }>;
    sourceGroups: Array<{
      label: string;
      reason: string;
      urls: string[];
    }>;
  };
  broadResearchMemo: string;
  planningBeats: Array<{
    beatId?: string;
    category: string;
    detail: string;
    sourceTitle: string;
    url?: string | null;
    priority?: string;
  }>;
  researchStrategyModel: string;
  researchStrategy: {
    primaryAngle: string;
    backupAngles: string[];
    hookIdea: string;
    storyType: string;
    mustPreserveBeats?: string[];
    beatDecisions?: Array<{
      beatId: string;
      beat: string;
      decision: string;
      reason: string;
      targetSectionId?: string | null;
    }>;
    videoStructure: Array<{
      sectionId: string;
      title: string;
      purpose: string;
      whyItMatters: string;
      evidenceNeeded: string[];
      searchPriorities: string[];
      targetWordCount: number;
    }>;
    globalSearchThemes: string[];
    risks: string[];
    skip: string[];
  };
  sectionQueryPlanningModel: string;
  sectionQueryPlanning: {
    globalQueries: Array<{
      label: string;
      objective: string;
      searchMode: string;
      query: string;
    }>;
    sectionQueries: Array<{
      sectionId: string;
      articleQueries: string[];
      videoQueries: string[];
      socialQueries: string[];
      podcastQueries: string[];
    }>;
  };
};

async function loadReport() {
  const candidates = [
    "debug-plan-mel-gibson-angle-anchor.json",
    "debug-plan-mel-gibson-tried-to-warn-you.json",
  ];

  for (const fileName of candidates) {
    const filePath = path.resolve(process.cwd(), "research", fileName);

    try {
      const content = await readFile(filePath, "utf8");
      return {
        report: JSON.parse(content) as DebugPlanReport,
        fileName,
      };
    } catch {
      continue;
    }
  }

  notFound();
}

function chip(label: string) {
  return (
    <span
      key={label}
      style={{
        display: "inline-block",
        padding: "6px 10px",
        borderRadius: 999,
        background: "rgba(34, 33, 58, 0.08)",
        color: "#22213a",
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

function sectionCard(title: string, children: ReactNode) {
  return (
    <section
      style={{
        border: "1px solid rgba(34, 33, 58, 0.12)",
        borderRadius: 22,
        background: "rgba(255,255,255,0.82)",
        boxShadow: "0 16px 40px rgba(41, 31, 74, 0.08)",
        padding: 24,
      }}
    >
      <h2
        style={{
          margin: "0 0 16px",
          fontSize: 24,
          lineHeight: 1.1,
          color: "#1f1b2f",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function MelGibsonPlanReviewPage() {
  const { report, fileName } = await loadReport();
  const sectionTitles = new Map(
    report.researchStrategy.videoStructure.map((section) => [section.sectionId, section.title] as const)
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(244, 206, 161, 0.28), transparent 38%), linear-gradient(180deg, #f6f0e5 0%, #e9e0d2 100%)",
        color: "#1f1b2f",
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
              color: "#6a5d4a",
            }}
          >
            Moon Internal
          </p>
          <h1
            style={{
              margin: "12px 0 8px",
              fontSize: "clamp(2rem, 3.2vw, 3.5rem)",
              lineHeight: 1.02,
            }}
          >
            Mel Gibson Research And Claude Plan
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: 860,
              fontSize: 16,
              lineHeight: 1.55,
              color: "#4a4356",
            }}
          >
            Fresh headline-only planning run rendered from the live
            `plan_research` artifact, including the broad research memo,
            preserved beats, Claude strategy, and the actual follow-up query
            plan.
          </p>
          <div style={{ marginTop: 14 }}>
            {chip(`Broad research: ${report.broadResearchProvider} / ${report.broadResearchModel}`)}
            {chip(`Strategy: ${report.researchStrategyModel}`)}
            {chip(`Query planner: ${report.sectionQueryPlanningModel}`)}
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 14, color: "#5c5465" }}>
            Source clip:{" "}
            <a href={report.sourceUrl} target="_blank" rel="noreferrer">
              {report.title}
            </a>
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#72697b" }}>
            Artifact: <code>{fileName}</code>
          </p>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.1fr 0.9fr",
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
                    {report.broadResearch.factualOverview}
                  </p>
                </div>
                <div>
                  <strong>Origin premise</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.broadResearch.originPremise}
                  </p>
                </div>
                <div>
                  <strong>Broader system</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.broadResearch.broaderSystem}
                  </p>
                </div>
                <div>
                  <strong>Resolution mechanism</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.broadResearch.resolutionMechanism}
                  </p>
                </div>
              </div>
            )}

            {sectionCard(
              "Key Facts And Turning Points",
              <div style={{ display: "grid", gap: 18 }}>
                <div>
                  <strong>Key facts</strong>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
                    {report.broadResearch.keyFacts.map((fact, index) => (
                      <li key={`${fact.fact}-${index}`}>
                        {fact.fact}
                        <div style={{ fontSize: 13, color: "#5f5769" }}>
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
                          {" · "}
                          {fact.confidence}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Tensions</strong>
                  <div style={{ marginTop: 10 }}>
                    {report.broadResearch.tensions.map(chip)}
                  </div>
                </div>
                <div>
                  <strong>Runway beats</strong>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
                    {report.broadResearch.runwayBeats.map((beat) => (
                      <li key={beat}>{beat}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Turning points</strong>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
                    {report.broadResearch.turningPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Stake shifters</strong>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
                    {report.broadResearch.stakeShifters.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {sectionCard(
              "Raw Research Memo",
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 13,
                  lineHeight: 1.55,
                  fontFamily:
                    'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
                }}
              >
                {report.broadResearchMemo}
              </pre>
            )}
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            {sectionCard(
              "Claude Strategy",
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <strong>Primary angle</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.researchStrategy.primaryAngle}
                  </p>
                </div>
                <div>
                  <strong>Hook</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.researchStrategy.hookIdea}
                  </p>
                </div>
                <div>
                  <strong>Story type</strong>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    {report.researchStrategy.storyType}
                  </p>
                </div>
                <div>
                  <strong>Global search themes</strong>
                  <div style={{ marginTop: 10 }}>
                    {report.researchStrategy.globalSearchThemes.map(chip)}
                  </div>
                </div>
                <div>
                  <strong>Risks</strong>
                  <div style={{ marginTop: 10 }}>
                    {report.researchStrategy.risks.length
                      ? report.researchStrategy.risks.map(chip)
                      : chip("none")}
                  </div>
                </div>
                <div>
                  <strong>Skip</strong>
                  <div style={{ marginTop: 10 }}>
                    {report.researchStrategy.skip.length
                      ? report.researchStrategy.skip.map(chip)
                      : chip("none")}
                  </div>
                </div>
              </div>
            )}

            {sectionCard(
              "Video Structure",
              <div style={{ display: "grid", gap: 16 }}>
                {report.researchStrategy.videoStructure.map((section, index) => (
                  <article
                    key={section.sectionId}
                    style={{
                      padding: 16,
                      borderRadius: 18,
                      background: "rgba(34, 33, 58, 0.04)",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "#706782", marginBottom: 6 }}>
                      Section {index + 1} · {section.sectionId} · {section.targetWordCount} words
                    </div>
                    <h3 style={{ margin: 0, fontSize: 18 }}>{section.title}</h3>
                    <p style={{ margin: "10px 0 0", lineHeight: 1.55 }}>
                      <strong>Purpose:</strong> {section.purpose}
                    </p>
                    <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>
                      <strong>Why it matters:</strong> {section.whyItMatters}
                    </p>
                    <div style={{ marginTop: 10 }}>
                      <strong>Evidence needed</strong>
                      <div style={{ marginTop: 8 }}>
                        {section.evidenceNeeded.length
                          ? section.evidenceNeeded.map(chip)
                          : chip("none")}
                      </div>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <strong>Search priorities</strong>
                      <div style={{ marginTop: 8 }}>
                        {section.searchPriorities.length
                          ? section.searchPriorities.map(chip)
                          : chip("none")}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {sectionCard(
              "Preserved Beats",
              <div style={{ display: "grid", gap: 14 }}>
                {report.planningBeats.map((beat, index) => (
                  <article
                    key={`${beat.detail}-${index}`}
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      background: "rgba(34, 33, 58, 0.04)",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "#706782", marginBottom: 6 }}>
                      {beat.beatId ?? `beat_${index + 1}`} · {beat.category}
                      {beat.priority ? ` · ${beat.priority}` : ""}
                    </div>
                    <div style={{ lineHeight: 1.55 }}>{beat.detail}</div>
                    <div style={{ marginTop: 8, fontSize: 13, color: "#5f5769" }}>
                      {beat.sourceTitle}
                      {beat.url ? (
                        <>
                          {" "}
                          ·{" "}
                          <a href={beat.url} target="_blank" rel="noreferrer">
                            source
                          </a>
                        </>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {sectionCard(
              "Beat Decisions And Query Plan",
              <div style={{ display: "grid", gap: 18 }}>
                <div>
                  <strong>Beat decisions</strong>
                  <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
                    {(report.researchStrategy.beatDecisions ?? []).map((beat) => (
                      <article
                        key={beat.beatId}
                        style={{
                          padding: 12,
                          borderRadius: 14,
                          background: "rgba(34, 33, 58, 0.04)",
                        }}
                      >
                        <div style={{ fontSize: 12, color: "#706782", marginBottom: 6 }}>
                          {beat.beatId} · {beat.decision}
                          {beat.targetSectionId
                            ? ` · ${sectionTitles.get(beat.targetSectionId) ?? beat.targetSectionId}`
                            : ""}
                        </div>
                        <div style={{ lineHeight: 1.5 }}>{beat.beat}</div>
                        <div style={{ marginTop: 8, fontSize: 13, color: "#5f5769" }}>
                          {beat.reason}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
                <div>
                  <strong>Global queries</strong>
                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    {report.sectionQueryPlanning.globalQueries.map((query) => (
                      <article
                        key={`${query.searchMode}-${query.query}`}
                        style={{
                          padding: 12,
                          borderRadius: 14,
                          background: "rgba(34, 33, 58, 0.04)",
                        }}
                      >
                        <div style={{ fontSize: 12, color: "#706782", marginBottom: 6 }}>
                          {query.searchMode} · {query.label}
                        </div>
                        <div style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13 }}>
                          {query.query}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 13, color: "#5f5769" }}>
                          {query.objective}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
                <div>
                  <strong>Section queries</strong>
                  <div style={{ display: "grid", gap: 14, marginTop: 10 }}>
                    {report.sectionQueryPlanning.sectionQueries.map((section) => (
                      <article
                        key={section.sectionId}
                        style={{
                          padding: 14,
                          borderRadius: 16,
                          background: "rgba(34, 33, 58, 0.04)",
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>
                          {sectionTitles.get(section.sectionId) ?? section.sectionId}
                        </div>
                        {[
                          ["Article", section.articleQueries],
                          ["Video", section.videoQueries],
                          ["Social", section.socialQueries],
                          ["Podcast", section.podcastQueries],
                        ].map(([label, queries]) => (
                          <div key={label as string} style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 13, color: "#6c6479", marginBottom: 4 }}>
                              {label}
                            </div>
                            {(queries as string[]).length ? (
                              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                                {(queries as string[]).map((query) => (
                                  <li
                                    key={query}
                                    style={{
                                      fontFamily:
                                        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
                                      fontSize: 13,
                                    }}
                                  >
                                    {query}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div style={{ fontSize: 13, color: "#8a8198" }}>none</div>
                            )}
                          </div>
                        ))}
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
