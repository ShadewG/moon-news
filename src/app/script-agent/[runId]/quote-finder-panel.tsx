"use client";

import { useCallback, useState } from "react";

interface QuoteResult {
  clipId: string;
  clipTitle: string;
  sourceUrl: string;
  channelOrContributor: string | null;
  quotes: Array<{
    quoteText: string;
    speaker: string | null;
    startMs: number;
    endMs: number;
    relevanceScore: number;
    context: string;
  }>;
}

interface QuoteFinderPanelProps {
  runId: string;
  selectedText: string | null;
  onInsertQuote: (formatted: string) => void;
  visible: boolean;
  onClose: () => void;
}

function formatTimestamp(ms: number) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function buildTimestampUrl(sourceUrl: string, startMs: number) {
  try {
    const url = new URL(sourceUrl);
    url.searchParams.set("t", String(Math.floor(startMs / 1000)));
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

export function QuoteFinderPanel({
  runId,
  selectedText,
  onInsertQuote,
  visible,
  onClose,
}: QuoteFinderPanelProps) {
  const [query, setQuery] = useState(selectedText ?? "");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<QuoteResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selected text into search when it changes
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const res = await fetch(`/api/scripts/${runId}/quote-search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error ?? `Failed (${res.status})`);
      }

      const data = await res.json() as { results: QuoteResult[] };
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [query, loading, runId]);

  const handleInsert = useCallback(
    (clip: QuoteResult, quote: QuoteResult["quotes"][0]) => {
      const formatted = [
        `[QUOTE: ${clip.clipTitle}]`,
        `"${quote.quoteText}"`,
        quote.speaker ? `— ${quote.speaker}` : null,
        `[${formatTimestamp(quote.startMs)}]`,
      ]
        .filter(Boolean)
        .join("\n");

      onInsertQuote(formatted);
    },
    [onInsertQuote]
  );

  if (!visible) return null;

  return (
    <div className="qfp-overlay">
      <div className="qfp-panel">
        <div className="qfp-header">
          <span className="qfp-title">Quote Finder</span>
          <span className="qfp-close" onClick={onClose}>
            &#10005;
          </span>
        </div>

        <div className="qfp-search-row">
          <input
            className="qfp-input"
            placeholder="Search clips & transcripts..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearch();
              }
            }}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <button
            className="qfp-search-btn"
            onClick={handleSearch}
            disabled={!query.trim() || loading}
          >
            {loading ? "..." : "Search"}
          </button>
        </div>

        {error && <div className="qfp-error">{error}</div>}

        <div className="qfp-results">
          {results.map((clip) => (
            <div key={clip.clipId} className="qfp-clip">
              <div className="qfp-clip-header">
                <div className="qfp-clip-title">{clip.clipTitle}</div>
                {clip.channelOrContributor && (
                  <div className="qfp-clip-channel">{clip.channelOrContributor}</div>
                )}
              </div>
              {clip.quotes.map((quote, qi) => (
                <div key={qi} className="qfp-quote">
                  <div className="qfp-quote-text">
                    &ldquo;{quote.quoteText}&rdquo;
                  </div>
                  <div className="qfp-quote-meta">
                    {quote.speaker && <span>{quote.speaker}</span>}
                    <a
                      href={buildTimestampUrl(clip.sourceUrl, quote.startMs)}
                      target="_blank"
                      rel="noreferrer"
                      className="qfp-timestamp"
                    >
                      {formatTimestamp(quote.startMs)}
                    </a>
                    <span className="qfp-relevance">
                      {quote.relevanceScore}% relevant
                    </span>
                  </div>
                  <div className="qfp-quote-context">{quote.context}</div>
                  <button
                    className="qfp-insert-btn"
                    onClick={() => handleInsert(clip, quote)}
                  >
                    Insert into script
                  </button>
                </div>
              ))}
            </div>
          ))}

          {searched && results.length === 0 && !loading && !error && (
            <div className="qfp-empty">No matching quotes found in the library.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export const quoteFinderStyles = `
.qfp-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100; display: flex; align-items: center; justify-content: center; }
.qfp-panel { background: #0c0c0c; border: 1px solid #222; border-radius: 6px; width: 600px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; }
.qfp-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #181818; }
.qfp-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #5b9; }
.qfp-close { font-size: 14px; color: #444; cursor: pointer; padding: 2px 6px; border-radius: 3px; }
.qfp-close:hover { background: #181818; color: #999; }

.qfp-search-row { display: flex; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #111; }
.qfp-input { flex: 1; padding: 8px 12px; background: #111; border: 1px solid #1a1a1a; border-radius: 3px; color: #ccc; font-family: inherit; font-size: 12px; outline: none; }
.qfp-input:focus { border-color: #333; }
.qfp-input::placeholder { color: #333; }
.qfp-search-btn { padding: 8px 16px; background: #1a2a1e; color: #5b9; border: none; border-radius: 3px; font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
.qfp-search-btn:hover { background: #2a3a2e; }
.qfp-search-btn:disabled { opacity: 0.5; cursor: default; }

.qfp-error { padding: 8px 16px; font-size: 11px; color: #a44; background: #2a0f0f; }

.qfp-results { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }

.qfp-clip { background: #111; border: 1px solid #1a1a1a; border-radius: 4px; overflow: hidden; }
.qfp-clip-header { padding: 10px 12px; border-bottom: 1px solid #151515; }
.qfp-clip-title { font-size: 12px; font-weight: 600; color: #ccc; margin-bottom: 2px; }
.qfp-clip-channel { font-size: 10px; color: #555; }

.qfp-quote { padding: 10px 12px; border-bottom: 1px solid #151515; }
.qfp-quote:last-child { border-bottom: none; }
.qfp-quote-text { font-size: 12px; color: #bbb; line-height: 1.6; margin-bottom: 6px; font-style: italic; }
.qfp-quote-meta { display: flex; align-items: center; gap: 10px; font-size: 10px; color: #555; margin-bottom: 4px; }
.qfp-timestamp { color: #5b9; text-decoration: none; }
.qfp-timestamp:hover { color: #7dc; }
.qfp-relevance { color: #c93; }
.qfp-quote-context { font-size: 10px; color: #666; line-height: 1.4; margin-bottom: 8px; }
.qfp-insert-btn { font-family: inherit; font-size: 10px; font-weight: 600; padding: 5px 12px; background: #1a2a1e; color: #5b9; border: none; border-radius: 2px; cursor: pointer; transition: all 0.12s; }
.qfp-insert-btn:hover { background: #2a3a2e; }

.qfp-empty { text-align: center; padding: 30px 20px; color: #444; font-size: 12px; }
`;
