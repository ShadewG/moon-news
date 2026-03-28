"use client";

import { useCallback, useState } from "react";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  result?: string;
  explanation?: string;
}

interface AiAssistantPanelProps {
  runId: string;
  selectedText: string | null;
  fullScript: string;
  researchContext: string | null;
  onApplyText: (text: string) => void;
}

export function AiAssistantPanel({
  runId,
  selectedText,
  fullScript,
  researchContext,
  onApplyText,
}: AiAssistantPanelProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const instruction = input.trim();
    if (!instruction || loading) return;

    setInput("");
    setError(null);
    setLoading(true);

    const userMsg: ConversationMessage = { role: "user", content: instruction };
    const newConv = [...conversation, userMsg];
    setConversation(newConv);

    try {
      const res = await fetch(`/api/scripts/${runId}/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction,
          selectedText,
          fullScript,
          researchContext,
          conversationHistory: newConv
            .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error ?? `Request failed (${res.status})`);
      }

      const data = await res.json() as { result: string; explanation: string };
      const assistantMsg: ConversationMessage = {
        role: "assistant",
        content: data.explanation,
        result: data.result,
        explanation: data.explanation,
      };
      setConversation([...newConv, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [input, loading, conversation, runId, selectedText, fullScript, researchContext]);

  if (collapsed) {
    return (
      <div className="sa-sidebar-card">
        <div
          className="sa-sidebar-label sa-clickable"
          onClick={() => setCollapsed(false)}
        >
          AI Assistant &#9656;
        </div>
      </div>
    );
  }

  return (
    <div className="sa-sidebar-card">
      <div
        className="sa-sidebar-label sa-clickable"
        onClick={() => setCollapsed(true)}
      >
        AI Assistant &#9662;
      </div>

      {selectedText && (
        <div className="aip-selection">
          <div className="aip-selection-label">Selected text:</div>
          <div className="aip-selection-text">
            &ldquo;{selectedText.slice(0, 120)}
            {selectedText.length > 120 ? "..." : ""}&rdquo;
          </div>
        </div>
      )}

      <div className="aip-input-row">
        <input
          className="sa-feedback-input"
          placeholder="make this punchier, add a transition..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={loading}
        />
        <button
          className="sa-feedback-add"
          onClick={handleSubmit}
          disabled={!input.trim() || loading}
        >
          {loading ? "\u2026" : "\u2192"}
        </button>
      </div>

      {error && <div className="aip-error">{error}</div>}

      <div className="aip-conversation">
        {conversation.map((msg, i) => (
          <div
            key={i}
            className={`aip-msg ${msg.role === "user" ? "aip-msg-user" : "aip-msg-ai"}`}
          >
            {msg.role === "user" ? (
              <div className="aip-msg-text">{msg.content}</div>
            ) : (
              <>
                <div className="aip-msg-explanation">{msg.explanation}</div>
                {msg.result && (
                  <>
                    <div className="aip-msg-result">{msg.result.slice(0, 400)}{msg.result.length > 400 ? "..." : ""}</div>
                    <button
                      className="aip-apply-btn"
                      onClick={() => onApplyText(msg.result!)}
                    >
                      Apply to script
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        ))}
        {loading && (
          <div className="aip-msg aip-msg-ai">
            <span className="aip-typing" />
          </div>
        )}
      </div>

      {conversation.length > 0 && (
        <button
          className="aip-clear"
          onClick={() => {
            setConversation([]);
            setError(null);
          }}
        >
          Clear conversation
        </button>
      )}
    </div>
  );
}

export const aiAssistantStyles = `
.aip-selection { background: #111; border: 1px solid #1a1a1a; border-radius: 3px; padding: 6px 8px; margin-bottom: 8px; }
.aip-selection-label { font-size: 9px; color: #444; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px; }
.aip-selection-text { font-size: 10px; color: #888; line-height: 1.4; font-style: italic; }

.aip-input-row { display: flex; gap: 6px; margin-bottom: 8px; }

.aip-error { font-size: 10px; color: #a44; padding: 6px 8px; background: #2a0f0f; border-radius: 3px; margin-bottom: 8px; }

.aip-conversation { display: flex; flex-direction: column; gap: 6px; max-height: 400px; overflow-y: auto; }
.aip-msg { padding: 8px 10px; border-radius: 3px; font-size: 11px; line-height: 1.5; }
.aip-msg-user { background: #0f1a2a; border: 1px solid #1a2a3a; color: #68a; }
.aip-msg-ai { background: #111; border: 1px solid #1a1a1a; color: #bbb; }
.aip-msg-text { }
.aip-msg-explanation { color: #888; margin-bottom: 6px; font-size: 10px; }
.aip-msg-result { background: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 2px; padding: 8px; font-size: 11px; color: #bbb; line-height: 1.6; margin-bottom: 6px; white-space: pre-wrap; font-family: 'IBM Plex Mono', ui-monospace, monospace; }
.aip-apply-btn { font-family: inherit; font-size: 9px; font-weight: 600; padding: 4px 10px; background: #1a2a1e; color: #5b9; border: none; border-radius: 2px; cursor: pointer; transition: all 0.12s; }
.aip-apply-btn:hover { background: #2a3a2e; }
.aip-typing { display: inline-block; width: 8px; height: 12px; background: #5b9; animation: aip-blink 0.8s step-end infinite; }
@keyframes aip-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
.aip-clear { display: block; width: 100%; margin-top: 8px; font-family: inherit; font-size: 9px; color: #444; background: none; border: none; cursor: pointer; text-align: center; padding: 4px; }
.aip-clear:hover { color: #666; }
`;
