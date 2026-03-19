"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { ScriptLabGenerateResponse, ScriptLabResponse, ScriptLabSavedRun } from "@/lib/script-lab";
import { ScriptLabResults } from "./script-lab-results";

const DEMO_RESEARCH = `Headline: Meta Kills Instagram Encryption — Your DMs Are No Longer Private

Key facts:
- Meta is rolling back end-to-end encryption protections in a major part of Instagram messaging.
- Internal justification centers on moderation, monetization, and product simplicity.
- Privacy advocates say the move creates a surveillance and abuse risk for ordinary users.
- The company is framing it as a safety tradeoff, but critics argue it mainly restores data visibility for Meta.

Why it matters:
- Instagram is a core social utility for millions of young users.
- The change alters what users assume is private communication.
- This fits a broader pattern of platforms expanding power while selling convenience and safety language.

Evidence notes:
- Include what changed, why Meta says it changed, what critics say, and what the practical consequence is for users.
- Stay skeptical and precise.`;

type RecentRun = Pick<ScriptLabSavedRun, "id" | "storyTitle" | "createdAt">;

export default function ScriptLabClient(props: {
  initialResult?: ScriptLabResponse | null;
  initialPermalink?: string | null;
  recentRuns?: RecentRun[];
}) {
  const [storyTitle, setStoryTitle] = useState("Meta Kills Instagram Encryption");
  const [notes, setNotes] = useState("");
  const [researchText, setResearchText] = useState(DEMO_RESEARCH);
  const [targetRuntimeMinutes, setTargetRuntimeMinutes] = useState(18);
  const [result, setResult] = useState<ScriptLabResponse | null>(props.initialResult ?? null);
  const [permalink, setPermalink] = useState<string | null>(props.initialPermalink ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/script-lab/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            storyTitle,
            researchText,
            notes,
            targetRuntimeMinutes,
          }),
        });

        const payload = (await response.json()) as ScriptLabGenerateResponse | { error?: string };
        if (!response.ok || !("result" in payload) || !("permalink" in payload)) {
          throw new Error("error" in payload ? payload.error ?? "Generation failed" : "Generation failed");
        }

        setResult(payload.result);
        setPermalink(payload.permalink);
      } catch (caughtError) {
        setResult(null);
        setPermalink(null);
        setError(caughtError instanceof Error ? caughtError.message : "Generation failed");
      }
    });
  }

  return (
    <main className="min-h-screen bg-[#071018] text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 max-w-3xl">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300/75">Script Lab</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Paste research, get a Claude draft and a longer Claude final.</h1>
          <p className="mt-4 text-sm leading-7 text-white/60">
            This tool scores the story against the Moon corpus, writes a first-pass Claude script, then rewrites and expands it into a longer final version with stricter voice cleanup.
          </p>
        </div>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <div className="grid gap-4 md:grid-cols-[1.5fr_0.7fr]">
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-white/50">Story title</span>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none ring-0"
                  value={storyTitle}
                  onChange={(event) => setStoryTitle(event.target.value)}
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-white/50">Runtime</span>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none ring-0"
                  type="number"
                  min={3}
                  max={25}
                  value={targetRuntimeMinutes}
                  onChange={(event) => setTargetRuntimeMinutes(Number(event.target.value) || 18)}
                />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-white/50">Optional notes</span>
              <textarea
                className="min-h-28 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white outline-none"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional editorial direction, angle notes, weak spots, or constraints."
              />
            </label>

            <label className="mt-4 block">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-white/50">Research dossier</span>
              <textarea
                className="min-h-[28rem] w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white outline-none"
                value={researchText}
                onChange={(event) => setResearchText(event.target.value)}
              />
            </label>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                className="rounded-full bg-cyan-300 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isPending}
                onClick={handleGenerate}
                type="button"
              >
                {isPending ? "Generating..." : "Generate Claude Script"}
              </button>

              {permalink ? (
                <Link
                  className="rounded-full border border-white/15 px-4 py-3 text-sm text-white/85 transition hover:border-cyan-300/40 hover:text-cyan-200"
                  href={permalink}
                >
                  Open saved run
                </Link>
              ) : null}

              {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-400/10 to-white/[0.03] p-6">
            <p className="text-xs uppercase tracking-[0.24em] text-white/50">How it works</p>
            <ol className="mt-4 space-y-3 text-sm leading-7 text-white/75">
              <li>1. The pasted research is scored against the Moon transcript corpus.</li>
              <li>2. Claude writes a first-pass documentary draft using the transcript-derived style rules.</li>
              <li>3. Claude critiques that draft against the same rubric and rewrites it.</li>
              <li>4. A final Claude pass strips AI-sounding phrasing and expands the script to a longer target length.</li>
              <li>5. Every generation is saved automatically and gets a permanent run page.</li>
            </ol>

            {props.recentRuns && props.recentRuns.length > 0 ? (
              <div className="mt-8 rounded-3xl border border-white/10 bg-black/20 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-white/50">Recent runs</p>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-white/75">
                  {props.recentRuns.map((run) => (
                    <li key={run.id}>
                      <Link className="transition hover:text-cyan-200" href={`/script-lab/${run.id}`}>
                        {run.storyTitle}
                      </Link>
                      <p className="text-xs text-white/45">
                        {new Date(run.createdAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        {result ? <ScriptLabResults result={result} /> : null}
      </div>
    </main>
  );
}
