"use client";

import { useState, useMemo } from "react";
import CopyLinksButton from "./copy-links";
import { YouTubeEmbed } from "./video-embed";

type Line = { id: string; lineKey: string; lineIndex: number; text: string; lineType: string; category: string | null };
type Asset = { id: string; scriptLineId: string; lineKey: string; provider: string; externalAssetId: string; title: string; previewUrl: string | null; sourceUrl: string; channelOrContributor: string | null; matchScore: number; durationMs: number | null; uploadDate: string | null; licenseType: string | null; isPrimarySource: boolean; filtered: boolean; filterReason: string | null; metadataJson: Record<string, unknown> | null; clipLibraryId: string | null };
type Quote = { id: string; scriptLineId: string; footageAssetId: string; lineKey: string; quoteText: string; speaker: string | null; startMs: number; endMs: number; relevanceScore: number; context: string | null };
type Source = { id: string; scriptLineId: string; lineKey: string; title: string; sourceName: string; sourceUrl: string; snippet: string | null; relevanceScore: number };
type Rec = { id: string; scriptLineId: string; recommendationType: string; reason: string; dismissed: boolean };

type Tab = "clips" | "quotes" | "articles";

export default function ReportClient({ data }: {
  data: {
    project: { id: string; title: string };
    lines: Line[];
    assets: Asset[];
    quotes: Quote[];
    sources: Source[];
    recs: Rec[];
  };
}) {
  const [selectedLineId, setSelectedLineId] = useState(data.lines[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("clips");
  const [showFiltered, setShowFiltered] = useState(false);

  const line = data.lines.find((l) => l.id === selectedLineId);

  const lineAssets = useMemo(() => data.assets.filter((a) => a.scriptLineId === selectedLineId), [data.assets, selectedLineId]);
  const lineQuotes = useMemo(() => data.quotes.filter((q) => q.scriptLineId === selectedLineId), [data.quotes, selectedLineId]);
  const lineSources = useMemo(() => data.sources.filter((s) => s.scriptLineId === selectedLineId), [data.sources, selectedLineId]);
  const lineRecs = useMemo(() => data.recs.filter((r) => r.scriptLineId === selectedLineId && !r.dismissed), [data.recs, selectedLineId]);

  const visible = lineAssets.filter((a) => !a.filtered);
  const filtered = lineAssets.filter((a) => a.filtered);
  const allLinks = data.assets.filter((a) => !a.filtered).map((a) => a.sourceUrl);
  const lineLinks = visible.map((a) => a.sourceUrl);

  const ytVisible = visible.filter((a) => a.provider === "youtube");
  const xVisible = visible.filter((a) => a.provider === "twitter");
  const otherVisible = visible.filter((a) => a.provider !== "youtube" && a.provider !== "twitter");

  return (
    <div className="h-screen flex bg-[#09090b] text-[#d4d4d8]">
      {/* Sidebar — script lines */}
      <div className="w-80 flex-shrink-0 border-r border-[#18181b] flex flex-col">
        <div className="px-4 py-4 border-b border-[#18181b]">
          <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest">Investigation Report</p>
          <h1 className="text-sm font-semibold text-white mt-1">{data.project.title}</h1>
          <div className="flex gap-3 mt-2 text-[10px] text-[#52525b]">
            <span><b className="text-[#a1a1aa]">{allLinks.length}</b> clips</span>
            <span><b className="text-[#a1a1aa]">{data.quotes.length}</b> quotes</span>
            <span><b className="text-[#a1a1aa]">{data.sources.length}</b> articles</span>
          </div>
          <div className="mt-3">
            <CopyLinksButton links={allLinks} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {data.lines.map((l) => {
            const lq = data.quotes.filter((q) => q.scriptLineId === l.id).length;
            const la = data.assets.filter((a) => a.scriptLineId === l.id && !a.filtered).length;
            const isSelected = l.id === selectedLineId;
            return (
              <button
                key={l.id}
                onClick={() => { setSelectedLineId(l.id); setTab("clips"); setShowFiltered(false); }}
                className={`w-full text-left px-4 py-3 border-b border-[#18181b] transition-colors ${
                  isSelected ? "bg-[#18181b]" : "hover:bg-[#0f0f12]"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono text-[#3f3f46]">{l.lineKey}</span>
                  {l.category && (
                    <span className="text-[9px] px-1 py-px rounded bg-[#1e1e22] text-[#52525b]">{l.category.replace(/_/g, " ")}</span>
                  )}
                  <div className="flex-1" />
                  {la > 0 && <span className="text-[9px] text-[#3f3f46]">{la} clips</span>}
                  {lq > 0 && <span className="text-[9px] text-amber-500/60">{lq} quotes</span>}
                </div>
                <p className={`text-[11px] leading-relaxed line-clamp-2 ${isSelected ? "text-[#e4e4e7]" : "text-[#71717a]"}`}>
                  {l.text}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Line header */}
        {line && (
          <div className="px-6 py-4 border-b border-[#18181b] bg-[#0c0c0e]">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono text-[#3f3f46]">{line.lineKey}</span>
              {line.category && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#18181b] text-[#71717a]">{line.category.replace(/_/g, " ")}</span>}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#18181b] text-[#3f3f46]">{line.lineType}</span>
              <div className="flex-1" />
              {lineLinks.length > 0 && <CopyLinksButton links={lineLinks} label={`Copy ${lineLinks.length} links`} small />}
            </div>
            <p className="text-[15px] text-[#e4e4e7] leading-relaxed">{line.text}</p>
            {lineRecs.map((r) => (
              <div key={r.id} className="flex gap-2 mt-3 p-2.5 rounded-lg bg-violet-500/5 border border-violet-500/15 text-[11px]">
                <span className="text-violet-400 font-medium">AI</span>
                <span className="text-[#a1a1aa]">{r.reason}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-[#18181b] bg-[#0c0c0e]">
          {([
            ["clips", `Clips (${visible.length})`],
            ["quotes", `Quotes (${lineQuotes.length})`],
            ["articles", `Articles (${lineSources.length})`],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-xs transition-colors ${
                tab === t
                  ? "text-white border-b-2 border-white"
                  : "text-[#52525b] hover:text-[#a1a1aa]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "clips" && (
            <div className="space-y-6">
              {/* YouTube */}
              {ytVisible.length > 0 && (
                <div>
                  <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold mb-3">YouTube ({ytVisible.length})</p>
                  <div className={`grid gap-3 ${ytVisible.length === 1 ? "grid-cols-1 max-w-lg" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"}`}>
                    {ytVisible.map((a) => <YTCard key={a.id} asset={a} />)}
                  </div>
                </div>
              )}
              {/* Twitter */}
              {xVisible.length > 0 && (
                <div>
                  <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold mb-3">X / Twitter ({xVisible.length})</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {xVisible.map((a) => <XCard key={a.id} asset={a} />)}
                  </div>
                </div>
              )}
              {/* Other */}
              {otherVisible.length > 0 && (
                <div>
                  <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold mb-2">Other ({otherVisible.length})</p>
                  {otherVisible.map((a) => (
                    <a key={a.id} href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#111114] text-xs">
                      {a.previewUrl && <img src={a.previewUrl} alt="" className="w-14 h-9 object-cover rounded" />}
                      <span className="text-[#d4d4d8] truncate flex-1">{decode(a.title)}</span>
                      <span className="text-[10px] text-[#27272a]">{a.matchScore}</span>
                    </a>
                  ))}
                </div>
              )}
              {/* Filtered */}
              {filtered.length > 0 && (
                <div>
                  <button onClick={() => setShowFiltered(!showFiltered)} className="text-[10px] text-[#27272a] hover:text-[#3f3f46] py-1">
                    {showFiltered ? "Hide" : "Show"} {filtered.length} filtered results
                  </button>
                  {showFiltered && (
                    <div className="mt-1 space-y-0.5 pl-3 border-l border-[#18181b]">
                      {filtered.map((a) => (
                        <a key={a.id} href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-[#27272a] hover:text-[#3f3f46] truncate">
                          [{a.provider}] {decode(a.title)} {a.filterReason && <span>— {a.filterReason}</span>}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {visible.length === 0 && line?.category === "transition" && (
                <p className="text-xs text-[#27272a] italic">Transition line — no footage needed</p>
              )}
              {visible.length === 0 && line?.category !== "transition" && (
                <p className="text-xs text-[#3f3f46]">No footage found for this line yet</p>
              )}
            </div>
          )}

          {tab === "quotes" && (
            <div className="space-y-3">
              {lineQuotes.length === 0 && (
                <p className="text-xs text-[#3f3f46]">No quotes extracted yet</p>
              )}
              {lineQuotes.map((q) => {
                const asset = data.assets.find((a) => a.id === q.footageAssetId);
                const secs = Math.floor(q.startMs / 1000);
                const hasTs = q.startMs > 0;
                const ts = hasTs ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : null;
                const link = asset?.provider === "youtube" && hasTs
                  ? `https://www.youtube.com/watch?v=${asset.externalAssetId}&t=${secs}`
                  : asset?.sourceUrl ?? "#";

                return (
                  <div key={q.id} className="p-4 rounded-lg bg-[#111114] border-l-2 border-amber-500/40">
                    <p className="text-[15px] text-[#e4e4e7] italic leading-relaxed">&ldquo;{q.quoteText}&rdquo;</p>
                    <div className="flex items-center gap-3 mt-3 text-xs text-[#52525b] flex-wrap">
                      {q.speaker && <span className="text-[#a1a1aa] font-medium">— {q.speaker}</span>}
                      {ts && (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="font-mono text-amber-400 hover:text-amber-300 underline underline-offset-2">
                          [{ts}]
                        </a>
                      )}
                      <span>{q.relevanceScore}/100</span>
                    </div>
                    {asset && (
                      <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 mt-2 text-[11px] text-[#3f3f46] hover:text-[#52525b]">
                        <span className={asset.provider === "twitter" ? "text-sky-400/60" : "text-red-400/60"}>
                          {asset.provider === "twitter" ? "X" : "YT"}
                        </span>
                        <span className="underline underline-offset-2">{decode(asset.title).slice(0, 60)}</span>
                        {ts && <span className="text-amber-400/50">at {ts}</span>}
                      </a>
                    )}
                    {q.context && <p className="text-[11px] text-[#3f3f46] mt-1.5">{q.context}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "articles" && (
            <div className="space-y-2">
              {lineSources.length === 0 && (
                <p className="text-xs text-[#3f3f46]">No articles found yet</p>
              )}
              {lineSources.map((s) => (
                <a key={s.id} href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="block p-3 rounded-lg bg-[#111114] border border-[#18181b] hover:border-[#27272a] transition-colors">
                  <p className="text-xs text-[#d4d4d8]">{s.title}</p>
                  <p className="text-[10px] text-[#3f3f46] mt-1">{s.sourceName}</p>
                  {s.snippet && <p className="text-[11px] text-[#3f3f46] mt-1.5 line-clamp-2">{s.snippet}</p>}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function YTCard({ asset }: { asset: Asset }) {
  const views = asset.metadataJson?.viewCount;
  const dur = asset.durationMs
    ? `${Math.floor(asset.durationMs / 60000)}:${String(Math.floor((asset.durationMs % 60000) / 1000)).padStart(2, "0")}`
    : "";
  const clipLink = asset.clipLibraryId ? `/clips/${asset.clipLibraryId}` : asset.sourceUrl;
  return (
    <div className="rounded-lg border border-[#18181b] bg-[#111114] overflow-hidden">
      <a href={clipLink}><YouTubeEmbed videoId={asset.externalAssetId} title={asset.title} /></a>
      <div className="px-3 py-2.5">
        <a href={clipLink} className="text-xs text-[#d4d4d8] hover:text-white leading-snug line-clamp-2 block">
          {decode(asset.title)}
        </a>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-[#3f3f46]">
          <span className="text-[#52525b]">{asset.channelOrContributor}</span>
          {dur && <span>{dur}</span>}
          {views != null && <span>{Number(views as number).toLocaleString()} views</span>}
        </div>
      </div>
    </div>
  );
}

function XCard({ asset }: { asset: Asset }) {
  const meta = asset.metadataJson;
  const views = meta?.viewCount;
  const likes = meta?.likeCount;
  const videoDesc = meta?.videoDescription as string | undefined;

  const clipLink = asset.clipLibraryId ? `/clips/${asset.clipLibraryId}` : asset.sourceUrl;

  return (
    <a href={clipLink} className="block p-3 rounded-lg bg-[#111114] border border-[#18181b] hover:border-[#27272a] transition-colors group">
      <p className="text-[12px] text-[#d4d4d8] leading-relaxed group-hover:text-white">{asset.title}</p>
      {videoDesc && videoDesc !== asset.title && (
        <p className="text-[11px] text-[#3f3f46] mt-1 line-clamp-2">{videoDesc}</p>
      )}
      <div className="flex items-center gap-3 mt-2 text-[10px] text-[#3f3f46]">
        <span className="text-sky-400">{asset.channelOrContributor}</span>
        {views != null && <span>{Number(views as number).toLocaleString()} views</span>}
        {likes != null && Number(likes) > 0 && <span>{Number(likes as number).toLocaleString()} likes</span>}
        <span className="ml-auto text-sky-400 opacity-0 group-hover:opacity-100">View →</span>
      </div>
    </a>
  );
}

function decode(t: string) {
  return t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
