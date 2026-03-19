import Link from "next/link";
import { notFound } from "next/navigation";

import { ScriptLabResults } from "@/app/script-lab/script-lab-results";
import { getScriptAgentRun } from "@/server/services/script-agent";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

function StatusBadge(props: { status: string }) {
  const tone =
    props.status === "complete"
      ? "bg-emerald-400/15 text-emerald-200"
      : props.status === "failed"
        ? "bg-rose-400/15 text-rose-200"
        : props.status === "running"
          ? "bg-cyan-400/15 text-cyan-200"
          : "bg-white/10 text-white/70";

  return (
    <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] ${tone}`}>
      {props.status}
    </span>
  );
}

export default async function ScriptAgentRunPage(props: PageProps) {
  const { runId } = await props.params;
  const run = await getScriptAgentRun(runId);

  if (!run) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#071018] text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 max-w-5xl">
          <Link className="text-sm text-cyan-200 transition hover:text-cyan-100" href="/script-lab">
            ← Back to Script Lab
          </Link>
          <p className="mt-6 text-xs uppercase tracking-[0.28em] text-cyan-300/75">Script Agent Run</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">{run.storyTitle}</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="mt-4 text-sm leading-7 text-white/55">
            Saved {new Date(run.createdAt).toLocaleString()} · Run ID {run.id}
          </p>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-4">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Current Stage</p>
            <p className="mt-3 text-lg font-medium text-white">
              {run.currentStage ? run.currentStage.replaceAll("_", " ") : "completed"}
            </p>
          </section>
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Sources</p>
            <p className="mt-3 text-3xl font-semibold text-white">{run.sources.length}</p>
          </section>
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Quotes</p>
            <p className="mt-3 text-3xl font-semibold text-white">{run.quotes.length}</p>
          </section>
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Claims</p>
            <p className="mt-3 text-3xl font-semibold text-white">{run.claims.length}</p>
          </section>
        </div>

        <div className="mb-8 grid gap-6 xl:grid-cols-[1.55fr_0.85fr]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Stage Timeline</p>
            <div className="mt-5 space-y-3">
              {run.stages.map((stage) => (
                <div
                  key={stage.id}
                  className="flex items-start justify-between gap-4 rounded-2xl bg-black/20 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-white">{stage.stageKey.replaceAll("_", " ")}</p>
                    {stage.errorText ? (
                      <p className="mt-1 text-sm text-rose-200">{stage.errorText}</p>
                    ) : (
                      <p className="mt-1 text-xs text-white/45">
                        {stage.startedAt ? `Started ${new Date(stage.startedAt).toLocaleString()}` : "Not started"}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={stage.status} />
                </div>
              ))}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <p className="text-xs uppercase tracking-[0.24em] text-white/45">Top Claims</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-white/85">
                {run.claims.length > 0 ? (
                  run.claims.slice(0, 8).map((claim) => (
                    <li key={claim.id} className="rounded-2xl bg-black/20 px-4 py-3">
                      <p>{claim.claimText}</p>
                      <p className="mt-2 text-xs text-white/45">
                        support {claim.supportLevel} · risk {claim.riskLevel}
                      </p>
                    </li>
                  ))
                ) : (
                  <li className="rounded-2xl bg-black/20 px-4 py-3 text-white/55">No claims extracted.</li>
                )}
              </ul>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <p className="text-xs uppercase tracking-[0.24em] text-white/45">Quote Bank</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-white/85">
                {run.quotes.length > 0 ? (
                  run.quotes.slice(0, 8).map((quote) => (
                    <li key={quote.id} className="rounded-2xl bg-black/20 px-4 py-3">
                      <p className="text-white/95">“{quote.quoteText}”</p>
                      <p className="mt-2 text-xs text-white/45">
                        {quote.sourceLabel}
                        {quote.speaker ? ` · ${quote.speaker}` : ""}
                      </p>
                    </li>
                  ))
                ) : (
                  <li className="rounded-2xl bg-black/20 px-4 py-3 text-white/55">No quotes extracted.</li>
                )}
              </ul>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs uppercase tracking-[0.24em] text-white/45">Run JSON</p>
                <Link
                  className="text-sm text-cyan-200 transition hover:text-cyan-100"
                  href={`/api/script-agent/runs/${run.id}`}
                >
                  Open API →
                </Link>
              </div>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-white/85">
                {run.sources.slice(0, 6).map((source) => (
                  <li key={source.id} className="rounded-2xl bg-black/20 px-4 py-3">
                    <p>{source.title}</p>
                    <p className="mt-1 text-xs text-white/45">
                      {source.providerName} · {source.sourceKind.replaceAll("_", " ")}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

        {run.result ? <ScriptLabResults result={run.result} /> : null}
      </div>
    </main>
  );
}
