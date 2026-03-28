import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

async function loadPromptDoc() {
  const filePath = path.resolve(
    process.cwd(),
    "research",
    "script-agent-prompts-and-models.md"
  );

  try {
    return await readFile(filePath, "utf8");
  } catch {
    notFound();
  }
}

export default async function ScriptAgentPromptsAndModelsPage() {
  const content = await loadPromptDoc();

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, #f7f2e8 0%, #efe6d7 100%)",
        color: "#1e1a15",
        padding: "40px 20px 80px",
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
        }}
      >
        <header style={{ marginBottom: 24 }}>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#6b6256",
            }}
          >
            Moon Internal
          </p>
          <h1
            style={{
              margin: "10px 0 8px",
              fontSize: "clamp(2rem, 3vw, 3.4rem)",
              lineHeight: 1.05,
              fontWeight: 800,
            }}
          >
            Script Agent Prompts And Models
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: 760,
              fontSize: 16,
              lineHeight: 1.5,
              color: "#4b4339",
            }}
          >
            Current-state prompt and model inventory for the Moon script-agent
            pipeline.
          </p>
        </header>

        <section
          style={{
            border: "1px solid rgba(30, 26, 21, 0.12)",
            borderRadius: 24,
            background: "rgba(255,255,255,0.78)",
            boxShadow: "0 18px 50px rgba(70, 53, 31, 0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid rgba(30, 26, 21, 0.08)",
              background: "rgba(245, 237, 225, 0.8)",
              fontSize: 13,
              color: "#5d554a",
            }}
          >
            Source file:{" "}
            <code
              style={{
                fontFamily:
                  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
              }}
            >
              research/script-agent-prompts-and-models.md
            </code>
          </div>

          <pre
            style={{
              margin: 0,
              padding: 24,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflowX: "auto",
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily:
                'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
            }}
          >
            {content}
          </pre>
        </section>
      </div>
    </main>
  );
}
