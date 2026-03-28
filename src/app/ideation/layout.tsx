import IdeationSidebar from "@/components/IdeationSidebar";

export const metadata = { title: "Ideation — Moon" };

export default function IdeationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="ib-shell">
        <IdeationSidebar />
        <main className="ib-main">{children}</main>
      </div>
      <style>{`
        .ib-shell {
          --ib-bg: #0a0a0a;
          --ib-surface: #111111;
          --ib-surface2: #1a1a1a;
          --ib-border: #222222;
          --ib-border-light: #2a2a2a;
          --ib-text: #cccccc;
          --ib-text-dim: #666666;
          --ib-text-bright: #e0e0e0;
          --ib-highlight: #ffffff;
          --ib-positive: #4a7a4a;
          --ib-positive-text: #7ab87a;
          --ib-negative: #7a4a4a;
          --ib-negative-text: #b87a7a;
          --ib-warn: #7a6a3a;
          --ib-warn-text: #b8a86a;
          --ib-hot: #b87a7a;
          --ib-warm: #b8a86a;
          --ib-cool: #6a8ab8;
          --ib-mono: 'SF Mono', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
          --ib-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;

          display: flex;
          min-height: calc(100vh - 32px);
          background: var(--ib-bg);
          color: var(--ib-text);
          font-family: var(--ib-ui);
          font-size: 13px;
          line-height: 1.45;
        }
        .ib-main {
          flex: 1;
          min-width: 0;
          padding: 20px 24px;
          overflow-y: auto;
          max-height: calc(100vh - 32px);
        }

        /* Shared ideation UI classes */
        .ib-page-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .ib-page-header h2 {
          font-family: var(--ib-ui);
          font-size: 18px;
          font-weight: 500;
          color: var(--ib-highlight);
          margin: 0;
        }
        .ib-stat-row {
          display: flex;
          gap: 1px;
          margin-bottom: 20px;
          background: var(--ib-border);
        }
        .ib-stat-cell {
          flex: 1;
          background: var(--ib-surface);
          padding: 12px 14px;
        }
        .ib-stat-label {
          font-family: var(--ib-mono);
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--ib-text-dim);
          margin-bottom: 4px;
        }
        .ib-stat-value {
          font-family: var(--ib-mono);
          font-size: 22px;
          font-weight: 400;
          color: var(--ib-highlight);
          letter-spacing: -0.5px;
        }
        .ib-panel {
          background: var(--ib-surface);
          border: 1px solid var(--ib-border);
          margin-bottom: 16px;
        }
        .ib-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 14px;
          border-bottom: 1px solid var(--ib-border);
          background: var(--ib-surface2);
        }
        .ib-panel-head h3 {
          font-family: var(--ib-mono);
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--ib-text-dim);
          margin: 0;
        }
        .ib-panel-link {
          font-family: var(--ib-mono);
          font-size: 10px;
          color: var(--ib-text-dim);
          cursor: pointer;
          text-decoration: none;
        }
        .ib-panel-link:hover { color: var(--ib-text); }
        .ib-meta {
          font-family: var(--ib-mono);
          font-size: 10px;
          color: var(--ib-text-dim);
        }
        table.ib-table {
          width: 100%;
          border-collapse: collapse;
        }
        .ib-table th {
          text-align: left;
          font-family: var(--ib-mono);
          font-size: 10px;
          font-weight: 400;
          color: var(--ib-text-dim);
          padding: 8px 14px;
          border-bottom: 1px solid var(--ib-border);
        }
        .ib-table td {
          padding: 8px 14px;
          border-bottom: 1px solid var(--ib-border);
          font-size: 12px;
        }
        .ib-table tr:hover td {
          background: rgba(255,255,255,0.01);
        }
        .ib-window-tabs {
          display: flex;
          gap: 0;
          border: 1px solid var(--ib-border);
        }
        .ib-window-tabs button {
          background: none;
          border: none;
          border-right: 1px solid var(--ib-border);
          color: var(--ib-text-dim);
          padding: 4px 12px;
          font-family: var(--ib-mono);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          cursor: pointer;
        }
        .ib-window-tabs button:last-child { border-right: none; }
        .ib-window-tabs button:hover { color: var(--ib-text); }
        .ib-window-tabs button.active { background: var(--ib-surface2); color: var(--ib-highlight); }
        .ib-btn {
          font-family: var(--ib-mono);
          font-size: 10px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 5px 12px;
          border: 1px solid var(--ib-border);
          background: var(--ib-surface2);
          color: var(--ib-text-dim);
          cursor: pointer;
          white-space: nowrap;
        }
        .ib-btn:hover { color: var(--ib-text); border-color: var(--ib-border-light); }
        .ib-btn:disabled { opacity: 0.5; cursor: default; }
        .ib-btn-primary {
          background: var(--ib-surface2);
          color: var(--ib-text-bright);
          border-color: var(--ib-border-light);
        }
        .ib-input {
          font-family: var(--ib-mono);
          font-size: 12px;
          padding: 5px 10px;
          background: var(--ib-bg);
          border: 1px solid var(--ib-border);
          color: var(--ib-text);
          outline: none;
          width: 100%;
        }
        .ib-input:focus { border-color: var(--ib-border-light); }
        .ib-input::placeholder { color: var(--ib-text-dim); }
        .ib-textarea {
          font-family: var(--ib-mono);
          font-size: 12px;
          padding: 10px;
          background: var(--ib-bg);
          border: 1px solid var(--ib-border);
          color: var(--ib-text);
          outline: none;
          width: 100%;
          min-height: 120px;
          resize: vertical;
          line-height: 1.6;
        }
        .ib-textarea:focus { border-color: var(--ib-border-light); }
        .ib-tag {
          display: inline-block;
          font-family: var(--ib-mono);
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 2px 5px;
          border: 1px solid var(--ib-border);
          color: var(--ib-text-dim);
        }
        .ib-grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 1000px) { .ib-grid-2 { grid-template-columns: 1fr; } }
        @media (max-width: 640px) {
          .ib-shell { flex-direction: column; }
          .ib-sidebar { width: 100% !important; min-width: 100% !important; flex-direction: row !important; overflow-x: auto; }
          .ib-main { max-height: none; padding: 12px; }
        }
      `}</style>
    </>
  );
}
