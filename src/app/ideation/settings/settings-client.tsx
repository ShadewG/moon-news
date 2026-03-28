"use client";

import { useCallback, useEffect, useState } from "react";

import { ideationGet, ideationPost, ideationPatch, timeAgo } from "@/lib/ideation-client";
import type { IdeaAgentSettingsRead, IdeaProvider } from "@/lib/ideation-types";

interface YtStatus {
  connected: boolean;
  channel_id?: string;
  channel_title?: string;
}

interface YtChannelInfo {
  channel_id: string;
  title: string;
  subscribers: number | null;
  video_count: number | null;
  total_views: number | null;
}

interface YtLocalStats {
  videos: number;
  daily_rows: number;
  traffic_rows: number;
  demographics_rows: number;
  geography_rows: number;
  latest_import: string | null;
}

export default function SettingsClient({
  initialSettings,
}: {
  initialSettings: IdeaAgentSettingsRead | null;
}) {
  /* ── Idea Agent state ── */
  const [settings, setSettings] = useState(initialSettings);
  const [provider, setProvider] = useState<IdeaProvider>(initialSettings?.provider ?? "heuristic");
  const [modelName, setModelName] = useState(initialSettings?.model_name ?? "");
  const [maxIter, setMaxIter] = useState(initialSettings?.max_iterations ?? 3);
  const [minAccepted, setMinAccepted] = useState(initialSettings?.min_accepted_ideas ?? 5);
  const [thinkingBudget, setThinkingBudget] = useState(initialSettings?.thinking_budget_tokens ?? 8000);
  const [interleaved, setInterleaved] = useState(initialSettings?.use_interleaved_thinking ?? false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  /* ── YouTube Analytics state ── */
  const [ytStatus, setYtStatus] = useState<YtStatus | null>(null);
  const [ytChannel, setYtChannel] = useState<YtChannelInfo | null>(null);
  const [ytStats, setYtStats] = useState<YtLocalStats | null>(null);
  const [ytLoading, setYtLoading] = useState(true);
  const [importStart, setImportStart] = useState("");
  const [importEnd, setImportEnd] = useState("");
  const [ytImporting, setYtImporting] = useState(false);
  const [ytImportStatus, setYtImportStatus] = useState("");

  const modelsForProvider = (settings?.available_models ?? []).filter(
    (m) => m.provider === provider
  );

  // When provider changes, auto-select first model for that provider
  useEffect(() => {
    const models = (settings?.available_models ?? []).filter((m) => m.provider === provider);
    if (models.length > 0 && !models.find((m) => m.id === modelName)) {
      setModelName(models[0].id);
    }
  }, [provider, settings?.available_models, modelName]);

  /* ── Idea Agent save ── */
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus("");
    const updated = await ideationPatch<IdeaAgentSettingsRead>("/settings/idea-agent", {
      provider,
      model_name: modelName,
      max_iterations: maxIter,
      min_accepted_ideas: minAccepted,
      thinking_budget_tokens: thinkingBudget,
      use_interleaved_thinking: interleaved,
    });
    if (updated) {
      setSettings(updated);
      setSaveStatus("Saved at " + new Date().toLocaleTimeString());
    } else {
      setSaveStatus("Failed to save settings.");
    }
    setSaving(false);
  }, [provider, modelName, maxIter, minAccepted, thinkingBudget, interleaved]);

  /* ── YouTube Analytics fetch ── */
  const fetchYtStatus = useCallback(async () => {
    setYtLoading(true);
    const status = await ideationGet<YtStatus>("/youtube-analytics/status");
    setYtStatus(status);
    if (status?.connected) {
      const [info, stats] = await Promise.all([
        ideationGet<YtChannelInfo>("/youtube-analytics/channel-info"),
        ideationGet<YtLocalStats>("/youtube-analytics/local-stats"),
      ]);
      setYtChannel(info);
      setYtStats(stats);
    }
    setYtLoading(false);
  }, []);

  useEffect(() => {
    fetchYtStatus();
  }, [fetchYtStatus]);

  const handleImport = useCallback(async () => {
    if (!importStart || !importEnd) return;
    setYtImporting(true);
    setYtImportStatus("");
    const result = await ideationPost<{ status: string }>(
      `/youtube-analytics/import-to-snapshots?start_date=${importStart}&end_date=${importEnd}`
    );
    setYtImportStatus(result ? "Import started." : "Import failed.");
    setYtImporting(false);
  }, [importStart, importEnd]);

  const handleFullImport = useCallback(async () => {
    setYtImporting(true);
    setYtImportStatus("");
    const result = await ideationPost<{ status: string }>("/youtube-analytics/full-import");
    setYtImportStatus(result ? "Full import started." : "Full import failed.");
    setYtImporting(false);
    // Refresh stats after a moment
    setTimeout(fetchYtStatus, 3000);
  }, [fetchYtStatus]);

  const handleDisconnect = useCallback(async () => {
    const result = await ideationPost<{ status: string }>("/youtube-analytics/disconnect");
    if (result) {
      setYtStatus({ connected: false });
      setYtChannel(null);
      setYtStats(null);
    }
  }, []);

  const uniqueProviders = Array.from(
    new Set((settings?.available_models ?? []).map((m) => m.provider))
  );

  return (
    <div>
      <div className="ib-page-header">
        <h2>Settings</h2>
      </div>

      {/* Panel 1: Idea Agent Settings */}
      <div className="ib-panel">
        <div className="ib-panel-head">
          <h3>Idea Agent Settings</h3>
          {settings?.updated_at && (
            <span className="ib-meta">updated {timeAgo(settings.updated_at)}</span>
          )}
        </div>
        <div style={{ padding: 14 }}>
          {!settings ? (
            <div className="ib-meta">Failed to load settings.</div>
          ) : (
            <div className="settings-grid">
              {/* Provider */}
              <label className="ib-meta">Provider</label>
              <select
                className="ib-select"
                value={provider}
                onChange={(e) => setProvider(e.target.value as IdeaProvider)}
              >
                {uniqueProviders.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>

              {/* Model */}
              <label className="ib-meta">Model</label>
              <select
                className="ib-select"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
              >
                {modelsForProvider.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.recommended ? " (recommended)" : ""}
                  </option>
                ))}
              </select>

              {/* Max iterations */}
              <label className="ib-meta">Max iterations</label>
              <input
                className="ib-input"
                type="number"
                min={1}
                max={8}
                value={maxIter}
                onChange={(e) => setMaxIter(Math.min(8, Math.max(1, Number(e.target.value))))}
                style={{ width: 80 }}
              />

              {/* Min accepted ideas */}
              <label className="ib-meta">Min accepted ideas</label>
              <input
                className="ib-input"
                type="number"
                min={1}
                max={20}
                value={minAccepted}
                onChange={(e) => setMinAccepted(Math.min(20, Math.max(1, Number(e.target.value))))}
                style={{ width: 80 }}
              />

              {/* Thinking budget */}
              <label className="ib-meta">Thinking budget tokens</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="range"
                  min={0}
                  max={32000}
                  step={1000}
                  value={thinkingBudget}
                  onChange={(e) => setThinkingBudget(Number(e.target.value))}
                  className="ib-slider"
                />
                <span className="ib-meta" style={{ minWidth: 50 }}>
                  {thinkingBudget.toLocaleString()}
                </span>
              </div>

              {/* Interleaved thinking */}
              <label className="ib-meta">Interleaved thinking</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={interleaved}
                  onChange={(e) => setInterleaved(e.target.checked)}
                />
                <span className="ib-meta">Enabled</span>
              </label>

              {/* Save button */}
              <div />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                <button className="ib-btn ib-btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </button>
                {saveStatus && <span className="ib-meta">{saveStatus}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Panel 2: YouTube Analytics */}
      <div className="ib-panel">
        <div className="ib-panel-head">
          <h3>YouTube Analytics</h3>
        </div>
        <div style={{ padding: 14 }}>
          {ytLoading ? (
            <div className="ib-meta">Checking connection...</div>
          ) : ytStatus?.connected ? (
            <div>
              {/* Channel info */}
              {ytChannel && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ color: "var(--ib-text-bright)", marginBottom: 4 }}>
                    {ytChannel.title}
                  </div>
                  <div className="ib-meta">
                    {ytChannel.channel_id}
                    {ytChannel.subscribers != null &&
                      ` · ${ytChannel.subscribers.toLocaleString()} subscribers`}
                    {ytChannel.video_count != null &&
                      ` · ${ytChannel.video_count.toLocaleString()} videos`}
                  </div>
                </div>
              )}

              {/* Local stats */}
              {ytStats && (
                <div style={{ marginBottom: 16, padding: "8px 12px", background: "var(--ib-bg)", border: "1px solid var(--ib-border)" }}>
                  <div className="ib-meta" style={{ marginBottom: 4 }}>Local Analytics Data</div>
                  <div className="ib-meta">
                    {ytStats.videos} videos · {ytStats.daily_rows} daily rows · {ytStats.traffic_rows} traffic · {ytStats.demographics_rows} demographics · {ytStats.geography_rows} geography
                    {ytStats.latest_import && <> · Last import: {ytStats.latest_import}</>}
                  </div>
                </div>
              )}

              {/* Import controls */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                <input
                  className="ib-input"
                  type="date"
                  value={importStart}
                  onChange={(e) => setImportStart(e.target.value)}
                  style={{ width: 150 }}
                />
                <span className="ib-meta">to</span>
                <input
                  className="ib-input"
                  type="date"
                  value={importEnd}
                  onChange={(e) => setImportEnd(e.target.value)}
                  style={{ width: 150 }}
                />
                <button
                  className="ib-btn ib-btn-primary"
                  disabled={ytImporting || !importStart || !importEnd}
                  onClick={handleImport}
                >
                  {ytImporting ? "Importing..." : "Import Range"}
                </button>
                <button className="ib-btn" disabled={ytImporting} onClick={handleFullImport}>
                  Full Import
                </button>
              </div>

              {ytImportStatus && (
                <div style={{ marginBottom: 12 }}>
                  <span className="ib-meta">{ytImportStatus}</span>
                </div>
              )}

              {/* Disconnect */}
              <div style={{ borderTop: "1px solid var(--ib-border)", paddingTop: 12, marginTop: 8 }}>
                <button className="ib-btn" onClick={handleDisconnect}>
                  Disconnect YouTube
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="ib-meta" style={{ marginBottom: 12 }}>
                YouTube Analytics is not connected.
              </div>
              <a
                href="/api/ideation/youtube-analytics/authorize"
                className="ib-btn ib-btn-primary"
                style={{ display: "inline-block", textDecoration: "none" }}
              >
                Connect YouTube
              </a>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .settings-grid {
          display: grid;
          grid-template-columns: 160px 1fr;
          gap: 10px 16px;
          align-items: center;
        }
        .ib-select {
          font-family: var(--ib-mono);
          font-size: 11px;
          padding: 5px 8px;
          background: var(--ib-bg);
          border: 1px solid var(--ib-border);
          color: var(--ib-text);
          cursor: pointer;
          outline: none;
          width: 100%;
          max-width: 320px;
        }
        .ib-select:hover {
          border-color: var(--ib-border-light);
        }
        .ib-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 200px;
          height: 4px;
          background: var(--ib-border);
          border-radius: 2px;
          outline: none;
          cursor: pointer;
        }
        .ib-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--ib-text-dim);
          border: 1px solid var(--ib-border-light);
          cursor: pointer;
        }
        .ib-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--ib-text-dim);
          border: 1px solid var(--ib-border-light);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
