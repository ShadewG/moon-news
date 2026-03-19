import type { ScriptLabResponse } from "@/lib/script-lab";

function OutputCard(props: {
  label: string;
  model: string;
  title: string;
  deck: string;
  script: string;
  beats: string[];
  angle: string;
  warnings: string[];
  extras?: string[];
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-300/80">{props.label}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{props.title}</h2>
          <p className="mt-2 text-sm text-white/55">{props.model}</p>
        </div>
      </div>

      <p className="rounded-2xl bg-black/20 px-4 py-3 text-sm leading-6 text-cyan-100">{props.deck}</p>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.8fr_0.9fr]">
        <article className="rounded-2xl bg-black/20 p-4">
          <p className="mb-3 text-xs uppercase tracking-[0.24em] text-white/45">Script</p>
          <div className="whitespace-pre-wrap text-sm leading-7 text-white/90">{props.script}</div>
        </article>

        <aside className="space-y-5">
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-white/45">Angle</p>
            <p className="text-sm leading-6 text-white/85">{props.angle}</p>
          </div>

          <div className="rounded-2xl bg-black/20 p-4">
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-white/45">Beats</p>
            <ul className="space-y-2 text-sm leading-6 text-white/85">
              {props.beats.map((beat) => (
                <li key={beat}>• {beat}</li>
              ))}
            </ul>
          </div>

          {props.extras && props.extras.length > 0 ? (
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="mb-3 text-xs uppercase tracking-[0.24em] text-white/45">Editor Notes</p>
              <ul className="space-y-2 text-sm leading-6 text-white/85">
                {props.extras.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {props.warnings.length > 0 ? (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
              <p className="mb-3 text-xs uppercase tracking-[0.24em] text-amber-200/80">Warnings</p>
              <ul className="space-y-2 text-sm leading-6 text-amber-50">
                {props.warnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

export function ScriptLabResults(props: { result: ScriptLabResponse }) {
  const { result } = props;
  const claudeExtras =
    result.variants.claude.editorialNotes
    ?? result.variants.claude.critiqueOfChatGPT?.mustFix
    ?? [];
  const finalVariant = result.variants.final ?? result.variants.hybrid ?? null;
  const finalExtras = result.variants.final?.editorialNotes ?? result.variants.hybrid?.mediationNotes ?? [];

  return (
    <div className="mt-8 space-y-6">
      <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-400/10 to-white/[0.03] p-6">
        <p className="text-xs uppercase tracking-[0.24em] text-white/50">Moon analysis</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-cyan-400/15 px-3 py-1 text-xs text-cyan-200">
            fit {result.moonAnalysis.moonFitScore} / {result.moonAnalysis.moonFitBand}
          </span>
          {result.moonAnalysis.clusterLabel ? (
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/75">
              {result.moonAnalysis.clusterLabel}
            </span>
          ) : null}
          {result.moonAnalysis.coverageMode ? (
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/75">
              {result.moonAnalysis.coverageMode}
            </span>
          ) : null}
        </div>

        {result.moonAnalysis.analogTitles.length > 0 ? (
          <div className="mt-5">
            <p className="text-xs uppercase tracking-[0.24em] text-white/50">Nearest analogs</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-white/75">
              {result.moonAnalysis.analogTitles.slice(0, 5).map((title) => (
                <li key={title}>• {title}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {result.variants.chatgpt ? (
        <OutputCard
          label="ChatGPT Draft"
          model={result.variants.chatgpt.model}
          title={result.variants.chatgpt.draft.title}
          deck={result.variants.chatgpt.draft.deck}
          script={result.variants.chatgpt.draft.script}
          beats={result.variants.chatgpt.draft.beats}
          angle={result.variants.chatgpt.draft.angle}
          warnings={result.variants.chatgpt.draft.warnings}
          extras={result.variants.chatgpt.critiqueOfClaude.mustFix}
        />
      ) : null}

      <OutputCard
        label="Claude Draft"
        model={result.variants.claude.model}
        title={result.variants.claude.draft.title}
        deck={result.variants.claude.draft.deck}
        script={result.variants.claude.draft.script}
        beats={result.variants.claude.draft.beats}
        angle={result.variants.claude.draft.angle}
        warnings={result.variants.claude.draft.warnings}
        extras={claudeExtras}
      />

      {finalVariant ? (
        <OutputCard
          label={result.variants.final ? "Claude Final" : "Hybrid Final"}
          model={finalVariant.model}
          title={finalVariant.draft.title}
          deck={finalVariant.draft.deck}
          script={finalVariant.draft.script}
          beats={finalVariant.draft.beats}
          angle={finalVariant.draft.angle}
          warnings={finalVariant.draft.warnings}
          extras={finalExtras}
        />
      ) : null}
    </div>
  );
}
