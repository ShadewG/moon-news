import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

async function loadTargetStateDoc() {
  const filePath = path.resolve(
    process.cwd(),
    "research",
    "script-agent-target-state-plan.md"
  );

  try {
    return await readFile(filePath, "utf8");
  } catch {
    notFound();
  }
}

export default async function ScriptAgentTargetStatePlanPage() {
  const content = await loadTargetStateDoc();

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(188, 116, 55, 0.18), transparent 34%), linear-gradient(180deg, #f6efe2 0%, #eee2cf 100%)",
        color: "#1f1811",
        padding: "40px 20px 80px",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
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
              color: "#6a5846",
            }}
          >
            Moon Internal
          </p>
          <h1
            style={{
              margin: "10px 0 8px",
              fontSize: "clamp(2rem, 3vw, 3.5rem)",
              lineHeight: 1.02,
              fontWeight: 800,
            }}
          >
            Script Agent Target-State Plan
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: 780,
              fontSize: 16,
              lineHeight: 1.55,
              color: "#4f4337",
            }}
          >
            Proposed Moon research and writing workflow, including the target AI
            stages, prompts, evidence flow, and search-budget rules.
          </p>
        </header>

        <section
          style={{
            border: "1px solid rgba(31, 24, 17, 0.12)",
            borderRadius: 24,
            background: "rgba(255,255,255,0.82)",
            boxShadow: "0 20px 60px rgba(74, 48, 20, 0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid rgba(31, 24, 17, 0.08)",
              background: "rgba(245, 233, 215, 0.85)",
              fontSize: 13,
              color: "#5b4b3d",
            }}
          >
            Source file:{" "}
            <code
              style={{
                fontFamily:
                  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
              }}
            >
              research/script-agent-target-state-plan.md
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
              lineHeight: 1.62,
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
