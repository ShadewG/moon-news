"use client";

import { useState, useRef, useCallback } from "react";

type Clip = { id: string; provider: string; externalId: string; title: string; sourceUrl: string; channelOrContributor: string | null; durationMs: number | null; viewCount: number | null; uploadDate: string | null };
type Segment = { text: string; startMs: number; durationMs: number };
type Quote = {
  id: string;
  quoteText: string;
  speaker: string | null;
  startMs: number;
  relevanceScore: number;
  context: string | null;
  provenance: "topic-search" | "script-agent";
  sourceLabel: string;
};
type Note = { id: string; text: string; timestampMs: number | null; color: string | null; createdAt: string };

type AiMoment = { text: string; startMs: number; timestamp: string };
type AiResponse = { answer: string; moments: AiMoment[] };
type AiHistoryEntry = { id: string; question: string; response: AiResponse; createdAt: string };
type FreshQuote = {
  quoteText: string;
  speaker: string | null;
  startMs: number;
  endMs: number;
  relevanceScore: number;
  context: string;
};
type Tab = "quotes" | "transcript" | "notes" | "ask";

export default function ClipDetailClient({ data }: {
  data: {
    clip: Clip;
    transcript: Segment[] | null;
    quotes: Quote[];
    notes: Note[];
    aiHistory: AiHistoryEntry[];
    initialTab: Tab | null;
  };
}) {
  const { clip, transcript, quotes } = data;
  const [tab, setTab] = useState<Tab>(
    data.initialTab ?? (quotes.length > 0 ? "quotes" : transcript ? "transcript" : "notes")
  );
  const [notes, setNotes] = useState(data.notes);
  const [noteText, setNoteText] = useState("");
  const [noteTs, setNoteTs] = useState("");
  const [playerTime, setPlayerTime] = useState(0);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [quoteQuery, setQuoteQuery] = useState("");
  const [quoteSearchLoading, setQuoteSearchLoading] = useState(false);
  const [freshQuotes, setFreshQuotes] = useState<FreshQuote[]>([]);
  const [freshQuoteQuery, setFreshQuoteQuery] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [aiHistory, setAiHistory] = useState<Array<{ question: string; response: AiResponse }>>(
    data.aiHistory.map((entry) => ({
      question: entry.question,
      response: entry.response,
    }))
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isYT = clip.provider === "youtube";
  const dur = clip.durationMs ? `${Math.floor(clip.durationMs / 60000)}:${String(Math.floor((clip.durationMs % 60000) / 1000)).padStart(2, "0")}` : "";

  const seekTo = useCallback((ms: number) => {
    const secs = Math.floor(ms / 1000);
    if (iframeRef.current) {
      iframeRef.current.src = `https://www.youtube.com/embed/${clip.externalId}?autoplay=1&start=${secs}`;
    }
    setPlayerTime(secs);
  }, [clip.externalId]);

  const fmtTs = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    const tsMs = noteTs ? parseTsToMs(noteTs) : null;
    const res = await fetch(`/api/clips/${clip.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: noteText, timestampMs: tsMs }),
    });
    if (res.ok) {
      const { note } = await res.json();
      setNotes((current) => [note, ...current]);
      setNoteText("");
      setNoteTs("");
    }
  };

  const askAi = async () => {
    if (!aiQuestion.trim() || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch(`/api/clips/${clip.id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: aiQuestion }),
      });
      if (res.ok) {
        const response: AiResponse = await res.json();
        setAiHistory((current) => [{ question: aiQuestion, response }, ...current]);
        setAiQuestion("");
      }
    } finally {
      setAiLoading(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    await fetch(`/api/clips/${clip.id}/notes?noteId=${noteId}`, { method: "DELETE" });
    setNotes((current) => current.filter((note) => note.id !== noteId));
  };

  const copyLibraryLink = async () => {
    if (typeof window === "undefined" || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(`${window.location.origin}/clips/${clip.id}`);
    setCopyStatus("copied");
    window.setTimeout(() => setCopyStatus("idle"), 1200);
  };

  const runQuoteSearch = async (mode: "query" | "strongest") => {
    if (!transcript || quoteSearchLoading) {
      return;
    }

    const resolvedQuery =
      mode === "query"
        ? quoteQuery.trim()
        : "";

    setQuoteSearchLoading(true);
    try {
      const res = await fetch(`/api/clips/${clip.id}/quote-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: resolvedQuery }),
      });

      if (!res.ok) {
        return;
      }

      const payload = (await res.json()) as {
        query: string;
        quotes: FreshQuote[];
      };

      setFreshQuotes(payload.quotes);
      setFreshQuoteQuery(payload.query);
      if (mode === "query") {
        setQuoteQuery("");
      }
    } finally {
      setQuoteSearchLoading(false);
    }
  };

  return (
    <div className="flex flex-col bg-[#09090b] text-[#d4d4d8]" style={{ height: "calc(100vh - 32px)" }}>
      {/* Top bar */}
      <div className="px-5 py-3 border-b border-[#18181b] bg-[#0c0c0e] flex items-center gap-4 flex-shrink-0">
        <a href="javascript:history.back()" className="text-xs text-[#3f3f46] hover:text-[#71717a]">&larr; Back</a>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-white truncate">{decode(clip.title)}</h1>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-[#3f3f46]">
            <span className="text-[#52525b]">{clip.channelOrContributor}</span>
            {dur && <span>{dur}</span>}
            {clip.viewCount && <span>{clip.viewCount.toLocaleString()} views</span>}
            {clip.uploadDate && <span>{clip.uploadDate.slice(0, 10)}</span>}
          </div>
        </div>
        <a href={clip.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#3f3f46] hover:text-[#71717a] flex-shrink-0">
          Open original &rarr;
        </a>
        <button
          onClick={copyLibraryLink}
          className="text-xs text-[#3f3f46] hover:text-[#d4d4d8] flex-shrink-0"
        >
          {copyStatus === "copied" ? "Copied link" : "Copy library link"}
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Video + Quotes/Transcript/Notes */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Video player */}
          {isYT && (
            <div className="bg-black flex-shrink-0">
              <div className="max-w-4xl mx-auto">
                <div className="aspect-video">
                  <iframe
                    ref={iframeRef}
                    src={`https://www.youtube.com/embed/${clip.externalId}?start=${playerTime}`}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-[#18181b] bg-[#0c0c0e] flex-shrink-0">
            {([
              ["quotes", `Quotes (${quotes.length})`] as const,
              ["transcript", `Transcript${transcript ? ` (${transcript.length})` : ""}`] as const,
              ["notes", `Notes (${notes.length})`] as const,
              ["ask", "Ask AI"] as const,
            ]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-2.5 text-xs transition-colors ${tab === t ? "text-white border-b-2 border-white" : "text-[#52525b] hover:text-[#a1a1aa]"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {tab === "quotes" && (
              <div className="max-w-4xl mx-auto px-5 py-5 space-y-3">
                {transcript && (
                  <div className="rounded-xl border border-[#18181b] bg-[#111114] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={quoteQuery}
                        onChange={(e) => setQuoteQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && quoteQuery.trim()) {
                            runQuoteSearch("query");
                          }
                        }}
                        placeholder="Find more quotes from this clip..."
                        className="min-w-[220px] flex-1 rounded-lg border border-[#18181b] bg-[#0f0f12] px-3 py-2 text-sm text-[#e4e4e7] placeholder-[#3f3f46] outline-none focus:border-[#27272a]"
                      />
                      <button
                        onClick={() => runQuoteSearch("query")}
                        disabled={!quoteQuery.trim() || quoteSearchLoading}
                        className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-200 disabled:opacity-40"
                      >
                        Find quotes
                      </button>
                      <button
                        onClick={() => runQuoteSearch("strongest")}
                        disabled={quoteSearchLoading}
                        className="rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-[11px] text-violet-200 disabled:opacity-40"
                      >
                        Strongest quotes
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-[#52525b]">
                      Pull fresh transcript-backed quotes from this specific video without leaving the Library.
                    </p>
                  </div>
                )}

                {freshQuotes.length > 0 && (
                  <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-200">Fresh Pull</p>
                        {freshQuoteQuery && (
                          <p className="mt-1 text-[11px] text-[#7dd3fc] line-clamp-2">{freshQuoteQuery}</p>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {freshQuotes.map((q, index) => (
                        <div
                          key={`${q.startMs}-${index}`}
                          className="rounded-lg border border-cyan-500/10 bg-[#0f0f12] p-4 cursor-pointer"
                          onClick={() => q.startMs > 0 && seekTo(q.startMs)}
                        >
                          <p className="text-[15px] text-[#e4e4e7] italic leading-relaxed">&ldquo;{q.quoteText}&rdquo;</p>
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#52525b]">
                            {q.speaker && <span className="text-[#a1a1aa] font-medium">— {q.speaker}</span>}
                            {q.startMs > 0 && <span className="font-mono text-cyan-300">[{fmtTs(q.startMs)}]</span>}
                            <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200">Fresh pull</span>
                            <span className="rounded bg-[#18181b] px-2 py-0.5 text-[10px]">{q.relevanceScore}/100</span>
                          </div>
                          {q.context && <p className="mt-2 text-[11px] text-[#3f3f46]">{q.context}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {quotes.length === 0 && <p className="text-xs text-[#3f3f46] py-8 text-center">No quotes extracted from this video yet</p>}
                {quotes.map((q) => (
                  <div
                    key={q.id}
                    className="p-4 rounded-xl bg-[#0f0f12] border border-[#18181b] border-l-3 border-l-amber-500/40 cursor-pointer hover:border-[#27272a] transition-colors"
                    onClick={() => q.startMs > 0 && seekTo(q.startMs)}
                  >
                    <p className="text-[15px] text-[#e4e4e7] italic leading-relaxed">&ldquo;{q.quoteText}&rdquo;</p>
                    <div className="flex items-center gap-3 mt-3 text-xs text-[#52525b] flex-wrap">
                      {q.speaker && <span className="text-[#a1a1aa] font-medium">— {q.speaker}</span>}
                      {q.startMs > 0 && (
                        <span className="font-mono text-amber-400 cursor-pointer hover:text-amber-300" onClick={(e) => { e.stopPropagation(); seekTo(q.startMs); }}>
                          [{fmtTs(q.startMs)}]
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded bg-[#18181b] text-[10px]">{q.relevanceScore}/100</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        q.provenance === "script-agent"
                          ? "bg-cyan-500/10 text-cyan-300"
                          : "bg-violet-500/10 text-violet-300"
                      }`}>
                        {q.provenance === "script-agent" ? "Script run" : "Topic search"}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#52525b] mt-2">{q.sourceLabel}</p>
                    {q.context && <p className="text-[11px] text-[#3f3f46] mt-2">{q.context}</p>}
                  </div>
                ))}
              </div>
            )}

            {tab === "transcript" && (
              <div className="max-w-4xl mx-auto px-5 py-5">
                {!transcript && <p className="text-xs text-[#3f3f46] py-8 text-center">No transcript available</p>}
                {transcript && (
                  <div className="space-y-0.5">
                    {transcript.map((seg, i) => {
                      const isQuoted = quotes.some((q) => Math.abs(q.startMs - seg.startMs) < 5000);
                      return (
                        <div
                          key={i}
                          className={`flex gap-3 py-1.5 px-2 rounded cursor-pointer hover:bg-[#111114] transition-colors ${isQuoted ? "bg-amber-500/5 border-l-2 border-amber-500/30" : ""}`}
                          onClick={() => seekTo(seg.startMs)}
                        >
                          <span className="text-[10px] font-mono text-[#3f3f46] w-10 flex-shrink-0 pt-0.5 text-right">
                            {fmtTs(seg.startMs)}
                          </span>
                          <p className={`text-[13px] leading-relaxed ${isQuoted ? "text-[#e4e4e7]" : "text-[#71717a]"}`}>
                            {seg.text}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === "notes" && (
              <div className="max-w-4xl mx-auto px-5 py-5 space-y-4">
                {/* Add note form */}
                <div className="p-4 rounded-xl bg-[#0f0f12] border border-[#18181b]">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Add a note about this clip..."
                    className="w-full bg-transparent text-sm text-[#e4e4e7] placeholder-[#3f3f46] outline-none resize-none"
                    rows={3}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) addNote(); }}
                  />
                  <div className="flex items-center gap-3 mt-2">
                    <input
                      type="text"
                      value={noteTs}
                      onChange={(e) => setNoteTs(e.target.value)}
                      placeholder="Timestamp (e.g. 3:42)"
                      className="px-2 py-1 rounded border border-[#18181b] bg-[#111114] text-xs text-[#a1a1aa] placeholder-[#3f3f46] outline-none w-28"
                    />
                    <div className="flex-1" />
                    <span className="text-[10px] text-[#3f3f46]">Cmd+Enter to save</span>
                    <button
                      onClick={addNote}
                      disabled={!noteText.trim()}
                      className="px-3 py-1 rounded-lg bg-white text-black text-xs font-medium disabled:opacity-30 hover:opacity-90 transition-opacity"
                    >
                      Save Note
                    </button>
                  </div>
                </div>

                {/* Notes list */}
                {notes.map((n) => (
                  <div key={n.id} className="p-4 rounded-xl bg-[#0f0f12] border border-[#18181b] group">
                    <div className="flex items-start gap-3">
                      <div className="w-1 h-full rounded-full bg-amber-500/30 flex-shrink-0 self-stretch" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#e4e4e7] leading-relaxed whitespace-pre-wrap">{n.text}</p>
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-[#3f3f46]">
                          {n.timestampMs != null && (
                            <span
                              className="font-mono text-amber-400 cursor-pointer hover:text-amber-300"
                              onClick={() => seekTo(n.timestampMs!)}
                            >
                              [{fmtTs(n.timestampMs)}]
                            </span>
                          )}
                          <span>{new Date(n.createdAt).toLocaleDateString()}</span>
                          <button
                            onClick={() => deleteNote(n.id)}
                            className="ml-auto text-[#27272a] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {notes.length === 0 && (
                  <p className="text-xs text-[#3f3f46] text-center py-4">No notes yet</p>
                )}
              </div>
            )}

            {tab === "ask" && (
              <div className="max-w-4xl mx-auto px-5 py-5 space-y-4">
                {/* Question input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={aiQuestion}
                    onChange={(e) => setAiQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") askAi(); }}
                    placeholder="Ask about this video... e.g. 'Does he mention waterboarding?' or 'What does he say about prison?'"
                    className="flex-1 px-3 py-2.5 rounded-lg border border-[#18181b] bg-[#111114] text-sm text-[#e4e4e7] placeholder-[#3f3f46] outline-none focus:border-[#27272a]"
                    disabled={aiLoading}
                  />
                  <button
                    onClick={askAi}
                    disabled={!aiQuestion.trim() || aiLoading}
                    className="px-4 py-2.5 rounded-lg bg-white text-black text-xs font-medium disabled:opacity-30 hover:opacity-90 transition-opacity flex-shrink-0"
                  >
                    {aiLoading ? "Thinking..." : "Ask"}
                  </button>
                </div>

                {!transcript && (
                  <p className="text-xs text-[#52525b] bg-[#111114] p-3 rounded-lg">No transcript available — AI needs a transcript to answer questions about this video.</p>
                )}

                {/* Suggested questions */}
                {aiHistory.length === 0 && transcript && (
                  <div>
                    <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold mb-2">Try asking</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        "What are the key claims made in this video?",
                        "Does he mention any specific dates or events?",
                        "What's the most quotable moment?",
                        "Does he talk about going to prison?",
                        "Summarize the main argument in 3 sentences",
                      ].map((q) => (
                        <button
                          key={q}
                          onClick={() => { setAiQuestion(q); }}
                          className="px-3 py-1.5 rounded-lg bg-[#111114] border border-[#18181b] text-xs text-[#71717a] hover:text-[#a1a1aa] hover:border-[#27272a] transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI conversation history */}
                {aiHistory.map((entry, i) => (
                  <div key={i} className="space-y-3">
                    {/* Question */}
                    <div className="flex gap-2">
                      <span className="text-[10px] text-[#52525b] bg-[#18181b] rounded px-1.5 py-0.5 flex-shrink-0">You</span>
                      <p className="text-sm text-[#a1a1aa]">{entry.question}</p>
                    </div>

                    {/* Answer */}
                    <div className="p-4 rounded-xl bg-[#0f0f12] border border-[#18181b]">
                      <p className="text-sm text-[#e4e4e7] leading-relaxed">{entry.response.answer}</p>

                      {entry.response.moments.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <p className="text-[10px] text-[#3f3f46] uppercase tracking-widest font-semibold">Relevant moments</p>
                          {entry.response.moments.map((m, j) => (
                            <div
                              key={j}
                              className="flex gap-3 p-3 rounded-lg bg-[#111114] cursor-pointer hover:bg-[#18181b] transition-colors"
                              onClick={() => seekTo(m.startMs)}
                            >
                              <span className="font-mono text-amber-400 text-xs flex-shrink-0 mt-0.5">
                                [{m.timestamp}]
                              </span>
                              <p className="text-xs text-[#d4d4d8] italic leading-relaxed">
                                &ldquo;{m.text}&rdquo;
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function parseTsToMs(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return parseInt(ts) * 1000 || 0;
}

function decode(t: string) {
  return t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}
