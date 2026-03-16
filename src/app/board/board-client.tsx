import Link from "next/link";

import type { BoardBootstrapPayload } from "@/server/services/board";

interface BoardClientProps {
  data: BoardBootstrapPayload;
}

export default function BoardClient({ data }: BoardClientProps) {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.24em] text-neutral-400">
            Research Board
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">Moon News Board</h1>
          <p className="max-w-3xl text-sm text-neutral-300">
            Backend bootstrap is live. This shell exposes stories, queue health, competitors,
            and sources so the richer board UI can wire against production data.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Stories" value={String(data.health.storyCount)} />
          <StatCard label="Queue" value={String(data.health.queueCount)} />
          <StatCard label="Healthy Sources" value={String(data.health.healthySources)} />
          <StatCard label="Competitor Alerts" value={String(data.health.competitorAlerts)} />
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Top Stories</h2>
              <span className="text-xs text-neutral-500">
                {data.stories.pageInfo.totalCount} total
              </span>
            </div>
            <div className="space-y-3">
              {data.stories.stories.map((story) => (
                <article
                  key={story.id}
                  className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">
                        {story.vertical ?? "General"}
                      </p>
                      <h3 className="text-base font-medium text-neutral-50">
                        {story.canonicalTitle}
                      </h3>
                    </div>
                    <div className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300">
                      {story.storyType}
                    </div>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-2 text-xs text-neutral-400">
                    <span>Surge {story.surgeScore}</span>
                    <span>Controversy {story.controversyScore}</span>
                    <span>{story.ageLabel}</span>
                    <span>{story.sourcesCount} sources</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {story.sourcePreviews.slice(0, 3).map((source) => (
                      <a
                        key={`${story.id}-${source.url}`}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:border-neutral-600"
                      >
                        {source.name}
                      </a>
                    ))}
                    <Link
                      href={`/api/board/stories/${story.slug}`}
                      className="rounded-full border border-sky-700 px-3 py-1 text-xs text-sky-300 hover:border-sky-500"
                    >
                      JSON
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5">
              <h2 className="mb-4 text-lg font-medium">Queue</h2>
              <div className="space-y-3">
                {data.queue.map((item) => (
                  <div key={item.id} className="rounded-xl border border-neutral-800 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-neutral-100">{item.storyTitle}</p>
                      <span className="text-xs text-neutral-500">#{item.position}</span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-400">{item.status}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5">
              <h2 className="mb-4 text-lg font-medium">Competitors</h2>
              <div className="space-y-3">
                {data.competitors.tiers.tier1.slice(0, 5).map((channel) => (
                  <div key={channel.id} className="rounded-xl border border-neutral-800 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-neutral-100">{channel.name}</p>
                      <span className="text-xs text-neutral-500">{channel.alertLevel}</span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-400">{channel.latestTitle}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-neutral-50">{value}</p>
    </div>
  );
}
