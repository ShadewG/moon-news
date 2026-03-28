import { ideationServerFetch } from "@/lib/ideation-api";

export const dynamic = "force-dynamic";

interface OutlineData {
  title?: string;
  review_url?: string;
  sections?: Array<{
    title?: string;
    heading?: string;
    content?: string;
    clips?: Array<{ label?: string; url?: string; start?: number; end?: number }>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export default async function OutlineDetailPage({
  params,
}: {
  params: Promise<{ source: string; sourceId: string[] }>;
}) {
  const { source, sourceId } = await params;
  const sourceIdPath = sourceId.join("/");
  const outline = await ideationServerFetch<OutlineData>(
    `/research/existing-outlines/${source}/${sourceIdPath}`,
  );

  if (!outline) {
    return (
      <div>
        <div className="ib-page-header">
          <h2>Outline Not Found</h2>
        </div>
        <div className="ib-panel" style={{ padding: 20, textAlign: "center" }}>
          <span className="ib-meta">
            Could not load outline for {source}/{sourceIdPath}.
          </span>
        </div>
      </div>
    );
  }

  const title =
    (outline.title as string) ||
    `${source}/${sourceIdPath}`;

  const reviewUrl = outline.review_url as string | undefined;

  // Extract sections — handle variable structure
  const sections: Array<Record<string, unknown>> =
    Array.isArray(outline.sections)
      ? outline.sections
      : [];

  // Collect top-level scalar fields for display (excluding known keys)
  const metaKeys = Object.keys(outline).filter(
    (k) =>
      !["title", "review_url", "sections"].includes(k) &&
      typeof outline[k] !== "object",
  );

  return (
    <div>
      <div className="ib-page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a
            href="/ideation/research"
            className="ib-btn"
            style={{ padding: "4px 10px", textDecoration: "none" }}
          >
            &larr; Back
          </a>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="ib-tag">{source}</span>
        </div>
        {reviewUrl && (
          <a
            href={reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ib-btn ib-btn-primary"
            style={{ textDecoration: "none" }}
          >
            Review &rarr;
          </a>
        )}
      </div>

      {/* Meta fields */}
      {metaKeys.length > 0 && (
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>Details</h3>
          </div>
          <div style={{ padding: 14 }}>
            {metaKeys.map((k) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "4px 0",
                  borderBottom: "1px solid var(--ib-border)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--ib-mono)",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--ib-text-dim)",
                    minWidth: 120,
                  }}
                >
                  {k.replace(/_/g, " ")}
                </span>
                <span style={{ color: "var(--ib-text)", fontSize: 12 }}>
                  {String(outline[k])}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sections */}
      {sections.length > 0 ? (
        sections.map((section, i) => {
          const sectionTitle =
            (section.title as string) ||
            (section.heading as string) ||
            `Section ${i + 1}`;
          const content = section.content as string | undefined;
          const clips = Array.isArray(section.clips) ? section.clips : [];

          // Extra fields in section beyond title/heading/content/clips
          const extraKeys = Object.keys(section).filter(
            (k) => !["title", "heading", "content", "clips"].includes(k),
          );

          return (
            <div className="ib-panel" key={i}>
              <div className="ib-panel-head">
                <h3>{sectionTitle}</h3>
                {clips.length > 0 && (
                  <span className="ib-meta">{clips.length} clips</span>
                )}
              </div>
              <div style={{ padding: 14 }}>
                {content && (
                  <div
                    style={{
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--ib-mono)",
                      fontSize: 12,
                      lineHeight: 1.6,
                      color: "var(--ib-text)",
                      marginBottom: clips.length > 0 || extraKeys.length > 0 ? 12 : 0,
                    }}
                  >
                    {content}
                  </div>
                )}

                {extraKeys.map((k) => {
                  const val = section[k];
                  return (
                    <div
                      key={k}
                      style={{
                        padding: "4px 0",
                        borderBottom: "1px solid var(--ib-border)",
                        display: "flex",
                        gap: 12,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--ib-mono)",
                          fontSize: 10,
                          color: "var(--ib-text-dim)",
                          textTransform: "uppercase",
                          minWidth: 100,
                        }}
                      >
                        {k.replace(/_/g, " ")}
                      </span>
                      <span style={{ color: "var(--ib-text)", fontSize: 12 }}>
                        {typeof val === "object" ? JSON.stringify(val) : String(val)}
                      </span>
                    </div>
                  );
                })}

                {clips.length > 0 && (
                  <table className="ib-table" style={{ marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th>Clip</th>
                        <th>URL</th>
                        <th>Range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clips.map(
                        (
                          clip: {
                            label?: string;
                            url?: string;
                            start?: number;
                            end?: number;
                          },
                          j: number,
                        ) => (
                          <tr key={j}>
                            <td style={{ color: "var(--ib-text)" }}>
                              {clip.label || `Clip ${j + 1}`}
                            </td>
                            <td>
                              {clip.url ? (
                                <a
                                  href={clip.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ib-panel-link"
                                >
                                  {clip.url.length > 60
                                    ? clip.url.slice(0, 60) + "..."
                                    : clip.url}
                                </a>
                              ) : (
                                <span className="ib-meta">--</span>
                              )}
                            </td>
                            <td className="ib-meta">
                              {clip.start != null && clip.end != null
                                ? `${clip.start}s - ${clip.end}s`
                                : "--"}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <div className="ib-panel">
          <div className="ib-panel-head">
            <h3>Content</h3>
          </div>
          <div
            style={{
              padding: 14,
              whiteSpace: "pre-wrap",
              fontFamily: "var(--ib-mono)",
              fontSize: 12,
              lineHeight: 1.6,
              color: "var(--ib-text)",
            }}
          >
            {/* Fallback: render entire outline as formatted JSON */}
            {JSON.stringify(outline, null, 2)}
          </div>
        </div>
      )}
    </div>
  );
}
