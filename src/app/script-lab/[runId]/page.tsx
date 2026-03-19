import Link from "next/link";
import { notFound } from "next/navigation";

import { getScriptLabRun } from "@/server/services/script-lab";
import { ScriptLabResults } from "../script-lab-results";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function SavedScriptLabRunPage(props: PageProps) {
  const { runId } = await props.params;
  const run = await getScriptLabRun(runId);

  if (!run) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#071018] text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 max-w-4xl">
          <Link className="text-sm text-cyan-200 transition hover:text-cyan-100" href="/script-lab">
            ← Back to Script Lab
          </Link>
          <p className="mt-6 text-xs uppercase tracking-[0.28em] text-cyan-300/75">Saved Run</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">{run.storyTitle}</h1>
          <p className="mt-4 text-sm leading-7 text-white/55">
            Saved {new Date(run.createdAt).toLocaleString()} · Run ID {run.id}
          </p>
        </div>

        <ScriptLabResults result={run.result} />
      </div>
    </main>
  );
}
