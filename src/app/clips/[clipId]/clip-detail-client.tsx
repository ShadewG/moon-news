"use client";

import { useState, useRef, useCallback } from "react";

type Clip = { id: string; provider: string; externalId: string; title: string; sourceUrl: string; channelOrContributor: string | null; durationMs: number | null; viewCount: number | null; uploadDate: string | null };
type Segment = { text: string; startMs: number; durationMs: number };
type Quote = { id: string; quoteText: string; speaker: string | null; startMs: number; relevanceScore: number; context: string | null };
type Note = { id: string; text: string; timestampMs: number | null; color: string | null; createdAt: string };

type Tab = "quotes" | "transcript" | "notes";

export default function ClipDetailClient({ data }: {
  data: { clip: Clip; transcript: Segment[] | null; quotes: Quote[]; notes: Note[] };
}) {
  const { clip, transcript, quotes } = data;
  const [tab, setTab] = useState<Tab>(quotes.length > 0 ? "quotes" : transcript ? "transcript" : "notes");
  const [notes, setNotes] = useState(data.notes);
  const [noteText, setNoteText] = useState("");
  const [noteTs, setNoteTs] = useState("");
  const [playerTime, setPlayerTime] = useState(0);
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
      setNotes([note, ...notes]);
      setNoteText("");
      setNoteTs("");
    }
  };

  const deleteNote = async (noteId: string) => {
    await fetch(`/api/clips/${clip.id}/notes?noteId=${noteId}`, { method: "DELETE" });
    setNotes(notes.filter((n) => n.id !== noteId));
  };

  return (
    <div className="h-screen flex flex-col bg-[#09090b] text-[#d4d4d8]">
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
                    </div>
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
