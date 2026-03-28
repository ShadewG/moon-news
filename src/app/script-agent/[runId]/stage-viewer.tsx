"use client";

import { useMemo, useState } from "react";

import { buildLibraryQuotesHref } from "@/lib/library-quotes";
import type { ScriptAgentRun, ScriptAgentStageKey } from "@/lib/script-agent";

function prettyStageName(stageKey: ScriptAgentStageKey) {
  return stageKey.replaceAll("_", " ");
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatTimestamp(ms: number | null | undefined) {
  if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
    return null;
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value, index) => String(value).padStart(index === 0 ? 1 : 2, "0")).join(":");
  }

  return `${String(minutes).padStart(1, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildTimestampUrl(sourceUrl: string | null | undefined, startMs: number | null | undefined) {
  if (!sourceUrl) {
    return null;
  }

  if (typeof startMs !== "number" || Number.isNaN(startMs) || startMs < 0) {
    return sourceUrl;
  }

  try {
    const url = new URL(sourceUrl);
    url.searchParams.set("t", String(Math.floor(startMs / 1000)));
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

function StageStatusBadge(props: { status: string }) {
  const tone =
    props.status === "complete"
      ? "bg-emerald-400/15 text-emerald-200"
      : props.status === "failed"
        ? "bg-rose-400/15 text-rose-200"
        : props.status === "running"
          ? "bg-cyan-400/15 text-cyan-200"
          : "bg-white/10 text-white/65";

  return <span className={`rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${tone}`}>{props.status}</span>;
}

function JsonBlock(props: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-2xl bg-black/30 p-4 text-xs leading-6 text-white/70">
      {JSON.stringify(props.value, null, 2)}
    </pre>
  );
}

function renderStageOutput(stageKey: ScriptAgentStageKey, output: unknown) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return <JsonBlock value={output} />;
  }

  const data = output as Record<string, any>;

  switch (stageKey) {
    case "plan_research":
      return (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Planning Mode</p>
              <p className="mt-3 text-sm leading-7 text-white/90">{data.planningMode ?? "unknown"}</p>
            </div>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Broad Research Model</p>
              <p className="mt-3 text-sm leading-7 text-white/90">{data.broadResearchModel ?? "unknown"}</p>
            </div>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Strategy Model</p>
              <p className="mt-3 text-sm leading-7 text-white/90">{data.researchStrategyModel ?? "unknown"}</p>
            </div>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Query Planner Model</p>
              <p className="mt-3 text-sm leading-7 text-white/90">{data.sectionQueryPlanningModel ?? "unknown"}</p>
            </div>
          </div>

          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Broad Research Overview</p>
            <p className="mt-3 text-sm leading-7 text-white/90">{data.broadResearch?.factualOverview ?? "No overview."}</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Tensions</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-white/85">
                {(data.broadResearch?.tensions ?? []).map((item: string) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Open Questions</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-white/85">
                {(data.broadResearch?.openQuestions ?? []).map((item: string) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Primary Angle</p>
            <p className="mt-3 text-sm leading-7 text-white/95">{data.researchStrategy?.primaryAngle ?? "No angle."}</p>
            <p className="mt-4 text-xs uppercase tracking-[0.2em] text-white/45">Hook Idea</p>
            <p className="mt-2 text-sm leading-7 text-white/85">{data.researchStrategy?.hookIdea ?? "No hook."}</p>
            <p className="mt-4 text-xs uppercase tracking-[0.2em] text-white/45">Story Type</p>
            <p className="mt-2 text-sm leading-7 text-white/85">{data.researchStrategy?.storyType ?? "Unknown"}</p>
            {Array.isArray(data.researchStrategy?.mustPreserveBeats) &&
            data.researchStrategy.mustPreserveBeats.length > 0 ? (
              <>
                <p className="mt-4 text-xs uppercase tracking-[0.2em] text-white/45">Must Preserve Beats</p>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-white/80">
                  {data.researchStrategy.mustPreserveBeats.map((beat: string) => (
                    <li key={beat}>• {beat}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          {Array.isArray(data.planningBeats) && data.planningBeats.length > 0 ? (
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Preserved Beat Ledger</p>
              <div className="mt-3 space-y-3">
                {data.planningBeats.map((beat: any) => (
                  <div key={beat.beatId} className="rounded-2xl bg-black/20 px-4 py-3">
                    <p className="text-sm font-medium text-white/95">
                      {beat.beatId} · {beat.category} · {beat.priority}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/85">{beat.detail}</p>
                    <p className="mt-2 text-xs text-white/50">
                      {beat.sourceTitle}
                      {beat.url ? ` — ${beat.url}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {Array.isArray(data.researchStrategy?.beatDecisions) &&
          data.researchStrategy.beatDecisions.length > 0 ? (
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Beat Decisions</p>
              <div className="mt-3 space-y-3">
                {data.researchStrategy.beatDecisions.map((beat: any) => (
                  <div key={beat.beatId} className="rounded-2xl bg-black/20 px-4 py-3">
                    <p className="text-sm font-medium text-white/95">
                      {beat.beatId} · {beat.decision}
                      {beat.targetSectionId ? ` · ${beat.targetSectionId}` : ""}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/85">{beat.beat}</p>
                    <p className="mt-2 text-xs leading-6 text-white/55">{beat.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Section Plan</p>
            <div className="mt-3 space-y-3">
              {(data.researchStrategy?.videoStructure ?? []).map((section: any, index: number) => (
                <div key={section.sectionId ?? `${section.title}-${index}`} className="rounded-2xl bg-black/20 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-cyan-400/15 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-200">
                      {index + 1}
                    </span>
                    <p className="text-sm font-medium text-white/95">{section.title}</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/85">{section.purpose}</p>
                  <p className="mt-2 text-xs leading-6 text-white/55">{section.whyItMatters}</p>
                  {Array.isArray(section.searchPriorities) && section.searchPriorities.length > 0 ? (
                    <p className="mt-2 text-xs text-white/50">search: {section.searchPriorities.join(" | ")}</p>
                  ) : null}
                  {Array.isArray(section.evidenceNeeded) && section.evidenceNeeded.length > 0 ? (
                    <p className="mt-1 text-xs text-white/50">evidence: {section.evidenceNeeded.join(" | ")}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Global Beam Queries</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-white/85">
              {(data.researchPlan?.globalBeams ?? []).map((beam: any) => (
                <li key={beam.beamId}>
                  <span className="text-white/95">{beam.label}</span>
                  <span className="text-white/55"> — {beam.query}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Section Query Planning</p>
            <div className="mt-3 space-y-4">
              {(data.sectionQueryPlanning?.sectionQueries ?? []).map((section: any) => (
                <div key={section.sectionId} className="rounded-2xl bg-black/20 px-4 py-3">
                  <p className="text-sm font-medium text-white/95">{section.sectionId}</p>
                  <div className="mt-2 space-y-1 text-xs leading-6 text-white/70">
                    {(section.articleQueries ?? []).map((query: string) => (
                      <p key={`article-${query}`}>article: {query}</p>
                    ))}
                    {(section.videoQueries ?? []).map((query: string) => (
                      <p key={`video-${query}`}>video: {query}</p>
                    ))}
                    {(section.socialQueries ?? []).map((query: string) => (
                      <p key={`social-${query}`}>social: {query}</p>
                    ))}
                    {(section.podcastQueries ?? []).map((query: string) => (
                      <p key={`podcast-${query}`}>podcast: {query}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    case "discover_sources":
    case "ingest_sources":
    case "extract_evidence":
      return (
        <div className="space-y-3">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="rounded-2xl bg-black/20 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">{key}</p>
              <p className="mt-2 text-sm text-white/90">{String(value)}</p>
            </div>
          ))}
        </div>
      );
    case "synthesize_research":
      return (
        <div className="space-y-5">
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Summary</p>
            <p className="mt-3 text-sm leading-7 text-white/90">{data.summary}</p>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Thesis</p>
            <p className="mt-3 text-sm leading-7 text-white/90">{data.thesis}</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Key Claims</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-white/85">
                {(data.keyClaims ?? []).map((claim: string) => (
                  <li key={claim}>• {claim}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Risky Claims</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-white/85">
                {(data.riskyClaims ?? []).length > 0 ? (
                  (data.riskyClaims ?? []).map((claim: string) => <li key={claim}>• {claim}</li>)
                ) : (
                  <li className="text-white/55">No risky claims flagged.</li>
                )}
              </ul>
            </div>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Quote Evidence</p>
            <div className="mt-3 space-y-3">
              {(data.quoteEvidence ?? []).map((quote: any) => {
                const libraryQuotesHref = buildLibraryQuotesHref({
                  sourceUrl: quote.sourceUrl,
                  title: quote.sourceTitle,
                });

                return (
                  <div key={`${quote.sourceTitle}-${quote.quoteText.slice(0, 32)}`} className="rounded-2xl bg-black/20 px-4 py-3">
                    <p className="text-sm leading-6 text-white/95">“{quote.quoteText}”</p>
                    <p className="mt-2 text-xs text-white/50">{quote.sourceTitle}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      {quote.sourceUrl ? (
                        <a
                          className="text-cyan-200 transition hover:text-cyan-100"
                          href={quote.sourceUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open source ↗
                        </a>
                      ) : null}
                      {libraryQuotesHref ? (
                        <a
                          className="text-amber-200 transition hover:text-amber-100"
                          href={libraryQuotesHref}
                        >
                          See quotes
                        </a>
                      ) : null}
                      {quote.startMs !== null && quote.startMs !== undefined ? (
                        <a
                          className="text-cyan-200 transition hover:text-cyan-100"
                          href={buildTimestampUrl(quote.sourceUrl, quote.startMs) ?? undefined}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Watch at {formatTimestamp(quote.startMs)}
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    case "select_quotes":
      return (
        <div className="space-y-5">
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Selected Quotes</p>
            <div className="mt-3 space-y-3">
              {(data.selectedQuotes ?? []).map((quote: any) => {
                const libraryQuotesHref = buildLibraryQuotesHref({
                  sourceUrl: quote.sourceUrl,
                  title: quote.sourceTitle,
                });

                return (
                  <div key={quote.quoteId} className="rounded-2xl bg-black/20 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-cyan-400/15 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-200">{quote.quoteId}</span>
                      <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-white/65">{quote.usePriority}</span>
                      <span className="text-xs text-white/45">{quote.sourceTitle}</span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-white/95">“{quote.quoteText}”</p>
                    <p className="mt-2 text-xs text-white/55">{quote.usageRole}</p>
                    {quote.sectionHint ? <p className="mt-1 text-xs text-white/45">hint: {quote.sectionHint}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      {quote.sourceUrl ? (
                        <a
                          className="text-cyan-200 transition hover:text-cyan-100"
                          href={quote.sourceUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open source ↗
                        </a>
                      ) : null}
                      {libraryQuotesHref ? (
                        <a
                          className="text-amber-200 transition hover:text-amber-100"
                          href={libraryQuotesHref}
                        >
                          See quotes
                        </a>
                      ) : null}
                      {quote.startMs !== null && quote.startMs !== undefined ? (
                        <a
                          className="text-cyan-200 transition hover:text-cyan-100"
                          href={buildTimestampUrl(quote.sourceUrl, quote.startMs) ?? undefined}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Watch at {formatTimestamp(quote.startMs)}
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Rejected Quotes</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-white/80">
              {(data.rejectedQuotes ?? []).length > 0 ? (
                (data.rejectedQuotes ?? []).map((quote: any) => (
                  <li key={`${quote.quoteText}-${quote.reason}`} className="rounded-2xl bg-black/20 px-4 py-3">
                    <p className="text-white/90">“{quote.quoteText}”</p>
                    <p className="mt-1 text-xs text-white/50">{quote.reason}</p>
                  </li>
                ))
              ) : (
                <li className="text-white/55">No rejected quotes recorded.</li>
              )}
            </ul>
          </div>
        </div>
      );
    case "build_outline":
      return (
        <div className="space-y-3">
          {(data.sections ?? []).map((section: any, index: number) => (
            <div key={`${section.heading}-${index}`} className="rounded-2xl bg-black/20 px-4 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-white/60">{index + 1}</span>
                <h3 className="text-base font-medium text-white">{section.heading}</h3>
                <span className="text-xs text-white/45">{section.targetWordCount} words</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-white/85">{section.purpose}</p>
              <p className="mt-2 text-sm leading-6 text-white/70">{section.beatGoal}</p>
              {(section.evidenceSlots ?? []).length > 0 ? (
                <p className="mt-2 text-xs text-cyan-200">evidence: {(section.evidenceSlots ?? []).join(" · ")}</p>
              ) : null}
            </div>
          ))}
        </div>
      );
    case "followup_research":
      return (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Sections</p>
              <p className="mt-2 text-2xl font-semibold text-white">{data.sectionCount ?? data.sectionPackages?.length ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Notes Saved</p>
              <p className="mt-2 text-2xl font-semibold text-white">{data.generatedNoteCount ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">YouTube Comments</p>
              <p className="mt-2 text-2xl font-semibold text-white">{data.youtubeCommentsInserted ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Reddit Comments</p>
              <p className="mt-2 text-2xl font-semibold text-white">{data.redditCommentsInserted ?? 0}</p>
            </div>
          </div>
          {data.thinSections?.length ? (
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">Thin Sections</p>
              <p className="mt-3 text-sm leading-6 text-white/80">{data.thinSections.join(" · ")}</p>
            </div>
          ) : null}
          <div className="space-y-3">
            {(data.sectionPackages ?? []).map((pkg: any) => (
              <div key={pkg.sectionHeading} className="rounded-2xl bg-black/20 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-base font-medium text-white">{pkg.sectionHeading}</h3>
                  <span className="text-xs text-white/45">
                    clips {pkg.clipCount ?? 0} · articles {pkg.articleCount ?? 0} · social {pkg.socialCount ?? 0} · quotes {pkg.quoteCount ?? 0}
                  </span>
                </div>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/85">{pkg.briefText}</div>
              </div>
            ))}
          </div>
        </div>
      );
    case "place_quotes":
      return (
        <div className="space-y-3">
          {(data.placements ?? []).map((placement: any) => (
            <div key={placement.sectionHeading} className="rounded-2xl bg-black/20 px-4 py-4">
              <h3 className="text-base font-medium text-white">{placement.sectionHeading}</h3>
              <p className="mt-2 text-sm leading-6 text-white/80">{placement.placementGoal}</p>
              {placement.requiredQuoteIds?.length ? (
                <p className="mt-3 text-xs text-cyan-200">required: {placement.requiredQuoteIds.join(" · ")}</p>
              ) : null}
              {placement.optionalQuoteIds?.length ? (
                <p className="mt-1 text-xs text-white/55">optional: {placement.optionalQuoteIds.join(" · ")}</p>
              ) : null}
            </div>
          ))}
        </div>
      );
    case "build_storyboard":
      return (
        <div className="space-y-3">
          {(data.beats ?? []).map((beat: any) => (
            <div key={beat.sectionHeading} className="rounded-2xl bg-black/20 px-4 py-4">
              <h3 className="text-base font-medium text-white">{beat.sectionHeading}</h3>
              <p className="mt-2 text-sm leading-6 text-white/85">{beat.visualApproach}</p>
              {beat.visualNotes?.length ? (
                <p className="mt-2 text-xs text-white/55">notes: {beat.visualNotes.join(" · ")}</p>
              ) : null}
              {beat.suggestedAssets?.length ? (
                <p className="mt-1 text-xs text-cyan-200">assets: {beat.suggestedAssets.join(" · ")}</p>
              ) : null}
            </div>
          ))}
        </div>
      );
    case "plan_sections":
      return (
        <div className="space-y-3">
          {(data.sections ?? []).map((section: any) => (
            <div key={section.sectionHeading} className="rounded-2xl bg-black/20 px-4 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-base font-medium text-white">{section.sectionHeading}</h3>
                <span className="text-xs text-white/45">{section.targetWordCount} words</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-white/85">{section.narrativeRole}</p>
              <p className="mt-2 text-xs text-white/55">open: {section.openingMove}</p>
              <p className="mt-1 text-xs text-white/55">close: {section.closingMove}</p>
              {section.requiredEvidence?.length ? (
                <p className="mt-2 text-xs text-cyan-200">required evidence: {section.requiredEvidence.join(" · ")}</p>
              ) : null}
            </div>
          ))}
        </div>
      );
    case "write_sections":
    case "revise_sections":
      return (
        <div className="space-y-4">
          {(data.sections ?? []).map((section: any) => (
            <div key={section.sectionHeading} className="rounded-2xl bg-black/20 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-base font-medium text-white">{section.sectionHeading}</h3>
                <span className="text-xs text-white/45">{section.actualWordCount ?? countWords(section.script)} words</span>
              </div>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/90">{section.script}</div>
              {section.evidenceUsed?.length ? (
                <p className="mt-3 text-xs text-cyan-200">evidence used: {section.evidenceUsed.join(" · ")}</p>
              ) : null}
            </div>
          ))}
        </div>
      );
    case "critique_script":
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          {(["strengths", "weaknesses", "mustFix", "keep"] as const).map((key) => (
            <div key={key} className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">{key}</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-white/85">
                {(data[key] ?? []).map((item: string) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          ))}
          <div className="rounded-2xl bg-black/20 p-4 lg:col-span-2">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Verdict</p>
            <p className="mt-3 text-sm leading-7 text-white/90">{data.verdict}</p>
          </div>
        </div>
      );
    case "analyze_retention":
      return (
        <div className="space-y-4">
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">Hook Assessment</p>
            <p className="mt-3 text-sm leading-7 text-white/90">{data.hookAssessment}</p>
          </div>
          {(["keepWatchingMoments", "deadZones", "mustFix", "pacingNotes"] as const).map((key) => (
            <div key={key} className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">{key}</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-white/85">
                {(data[key] ?? []).map((item: string) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    case "assemble_draft":
    case "polish_script":
      return (
        <div className="space-y-4">
          <div className="rounded-2xl bg-black/20 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-xl font-semibold text-white">{data.title}</h3>
              <span className="text-xs text-white/45">{countWords(data.script ?? "")} words</span>
            </div>
            <p className="mt-3 text-sm text-cyan-100">{data.deck}</p>
            <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-white/90">{data.script}</div>
          </div>
        </div>
      );
    case "expand_script": {
      const draft = data.draft ?? null;
      if (!draft) {
        return <JsonBlock value={data} />;
      }
      return (
        <div className="space-y-4">
          <div className="rounded-2xl bg-black/20 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-xl font-semibold text-white">{draft.title}</h3>
              <span className="text-xs text-white/45">{data.wordCount ?? countWords(draft.script)} words</span>
            </div>
            <p className="mt-3 text-sm text-cyan-100">{draft.deck}</p>
            <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-white/90">{draft.script}</div>
            {data.notes?.length ? <p className="mt-3 text-xs text-white/55">notes: {data.notes.join(" · ")}</p> : null}
          </div>
        </div>
      );
    }
    case "finalize_script": {
      const draft = data.draft ?? data;
      return (
        <div className="space-y-4">
          <div className="rounded-2xl bg-black/20 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-xl font-semibold text-white">{draft.title}</h3>
              <span className="text-xs text-white/45">{countWords(draft.script ?? "")} words</span>
            </div>
            <p className="mt-3 text-sm text-cyan-100">{draft.deck}</p>
            <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-white/90">{draft.script}</div>
          </div>
        </div>
      );
    }
    default:
      return <JsonBlock value={output} />;
  }
}

function getFallbackStageOutput(run: ScriptAgentRun, stageKey: ScriptAgentStageKey) {
  switch (stageKey) {
    case "synthesize_research":
      return run.result?.stages?.research ?? null;
    case "select_quotes":
      return run.result?.stages?.quoteSelection ?? null;
    case "build_outline":
      return run.result?.stages?.outline ?? null;
    case "place_quotes":
      return run.result?.stages?.quotePlacement ?? null;
    case "build_storyboard":
      return run.result?.stages?.storyboard ?? null;
    case "plan_sections":
      return run.result?.stages?.sectionPlan ?? null;
    case "write_sections":
      return run.result?.stages?.sectionDrafts ?? null;
    case "revise_sections":
      return run.result?.stages?.finalSectionDrafts ?? null;
    case "analyze_retention":
      return run.result?.stages?.retention ?? null;
    case "assemble_draft":
      return run.result?.variants?.claude?.draft ?? null;
    case "finalize_script":
      return run.result?.variants?.final ?? null;
    case "expand_script":
      return run.result?.variants?.final
        ? {
            draft: run.result.variants.final.draft,
            wordCount: countWords(run.result.variants.final.draft.script),
            notes: run.result.variants.final.editorialNotes,
          }
        : null;
    default:
      return null;
  }
}

export function ScriptAgentStageViewer(props: { run: ScriptAgentRun }) {
  const { run } = props;
  const initialStage =
    run.currentStage
    ?? run.stages.at(-1)?.stageKey
    ?? "synthesize_research";
  const [selectedStageKey, setSelectedStageKey] = useState<ScriptAgentStageKey>(initialStage);

  const selectedStage = useMemo(
    () => run.stages.find((stage) => stage.stageKey === selectedStageKey) ?? run.stages[0],
    [run.stages, selectedStageKey]
  );

  const stageOutput = selectedStage?.outputJson ?? getFallbackStageOutput(run, selectedStageKey);
  const stageInput = selectedStage?.inputJson ?? null;

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <p className="text-xs uppercase tracking-[0.24em] text-white/45">Stage Inspector</p>
        {selectedStage ? <StageStatusBadge status={selectedStage.status} /> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {run.stages.map((stage) => (
            <button
              key={stage.id}
              className={`flex w-full items-start justify-between gap-3 rounded-2xl px-4 py-3 text-left transition ${
                stage.stageKey === selectedStageKey
                  ? "bg-cyan-400/15 text-white"
                  : "bg-black/20 text-white/70 hover:bg-black/30 hover:text-white"
              }`}
              onClick={() => setSelectedStageKey(stage.stageKey)}
              type="button"
            >
              <div>
                <p className="text-sm font-medium">{prettyStageName(stage.stageKey)}</p>
                <p className="mt-1 text-xs text-white/45">
                  {stage.startedAt ? new Date(stage.startedAt).toLocaleString() : "Not started"}
                </p>
              </div>
              <StageStatusBadge status={stage.status} />
            </button>
          ))}
        </div>

        <div className="space-y-5">
          <div>
            <h2 className="text-2xl font-semibold text-white">{prettyStageName(selectedStageKey)}</h2>
            {selectedStage?.errorText ? <p className="mt-2 text-sm text-rose-200">{selectedStage.errorText}</p> : null}
          </div>

          {stageOutput ? renderStageOutput(selectedStageKey, stageOutput) : (
            <div className="rounded-2xl bg-black/20 px-4 py-4 text-sm text-white/55">
              No saved output for this stage yet.
            </div>
          )}

          <details className="rounded-2xl bg-black/20 p-4">
            <summary className="cursor-pointer text-xs uppercase tracking-[0.2em] text-white/45">
              Raw Stage Input / Output
            </summary>
            <div className="mt-4 grid gap-4">
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.2em] text-white/45">Input</p>
                <JsonBlock value={stageInput} />
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.2em] text-white/45">Output</p>
                <JsonBlock value={stageOutput} />
              </div>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
