"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import {
  ideationGet,
  ideationPost,
  ideationPatch,
  timeAgo,
} from "@/lib/ideation-client";
import type {
  WatchlistChannelRead,
  WatchlistImportResult,
  QuickAddChannelRead,
  PriorityTier,
  ChannelStatus,
} from "@/lib/ideation-types";

type TierFilter = "all" | PriorityTier;

const TIER_TABS: { key: TierFilter; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "priority", label: "PRIORITY" },
  { key: "standard", label: "STANDARD" },
  { key: "low", label: "LOW" },
];

const TIERS: PriorityTier[] = ["priority", "standard", "low"];
const STATUSES: ChannelStatus[] = ["active", "paused"];

export default function WatchlistClient({
  initialChannels,
}: {
  initialChannels: WatchlistChannelRead[];
}) {
  const [channels, setChannels] = useState(initialChannels);
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [search, setSearch] = useState("");
  const [quickUrl, setQuickUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const data = await ideationGet<WatchlistChannelRead[]>("/watchlist");
    if (data) setChannels(data);
  }, []);

  const handleQuickAdd = useCallback(async () => {
    const url = quickUrl.trim();
    if (!url) return;
    setAdding(true);
    setStatus("");
    const result = await ideationPost<QuickAddChannelRead>("/watchlist/quick-add", { url });
    if (result) {
      setStatus(`Added "${result.title}" — ${result.videos_imported} videos imported`);
      setQuickUrl("");
      await refresh();
    } else {
      setStatus("Failed to add channel. Check the URL and try again.");
    }
    setAdding(false);
  }, [quickUrl, refresh]);

  const handleImport = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setImporting(true);
    setStatus("");
    const form = new FormData();
    form.append("file", file);
    const result = await ideationPost<WatchlistImportResult>("/watchlist/import", form, true);
    if (result) {
      setStatus(
        `Import complete: ${result.inserted_count} added, ${result.updated_count} updated` +
          (result.errors.length ? ` (${result.errors.length} errors)` : "")
      );
      await refresh();
    } else {
      setStatus("Import failed.");
    }
    if (fileRef.current) fileRef.current.value = "";
    setImporting(false);
  }, [refresh]);

  const handleTierChange = useCallback(
    async (channelId: number, tier: PriorityTier) => {
      const updated = await ideationPatch<WatchlistChannelRead>(
        `/watchlist/${channelId}`,
        { priority_tier: tier }
      );
      if (updated) {
        setChannels((prev) => prev.map((c) => (c.id === channelId ? updated : c)));
      }
    },
    []
  );

  const handleStatusChange = useCallback(
    async (channelId: number, newStatus: ChannelStatus) => {
      const updated = await ideationPatch<WatchlistChannelRead>(
        `/watchlist/${channelId}`,
        { status: newStatus }
      );
      if (updated) {
        setChannels((prev) => prev.map((c) => (c.id === channelId ? updated : c)));
      }
    },
    []
  );

  const searchLower = search.toLowerCase().trim();
  const filtered = channels
    .filter((ch) => {
      if (tierFilter !== "all" && ch.priority_tier !== tierFilter) return false;
      if (!searchLower) return true;
      // Search title, tags, category, youtube ID, and notes
      if (ch.title.toLowerCase().includes(searchLower)) return true;
      if (ch.youtube_channel_id.toLowerCase().includes(searchLower)) return true;
      if (ch.primary_category_label.toLowerCase().includes(searchLower)) return true;
      if (ch.notes?.toLowerCase().includes(searchLower)) return true;
      if (ch.topic_tags.some((t) => t.toLowerCase().includes(searchLower))) return true;
      return false;
    })
    .sort((a, b) => {
      if (!searchLower) return a.title.localeCompare(b.title);
      // Sort exact title matches first, then tag matches, then the rest
      const aTitle = a.title.toLowerCase().includes(searchLower) ? 0 : 1;
      const bTitle = b.title.toLowerCase().includes(searchLower) ? 0 : 1;
      if (aTitle !== bTitle) return aTitle - bTitle;
      return a.title.localeCompare(b.title);
    });

  return (
    <div>
      <div className="ib-page-header">
        <h2>Watchlist</h2>
        <span className="ib-meta">{channels.length} channels</span>
      </div>

      {/* Quick-add row */}
      <div className="ib-panel">
        <div className="ib-panel-head">
          <h3>Quick Add Channel</h3>
        </div>
        <div style={{ padding: 14, display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="ib-input"
            style={{ maxWidth: 420 }}
            placeholder="YouTube channel or video URL..."
            value={quickUrl}
            onChange={(e) => setQuickUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
          />
          <button className="ib-btn ib-btn-primary" disabled={adding || !quickUrl.trim()} onClick={handleQuickAdd}>
            {adding ? "Adding..." : "Add"}
          </button>
          <div style={{ width: 1, height: 20, background: "var(--ib-border)", margin: "0 4px" }} />
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleImport}
          />
          <button
            className="ib-btn"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            {importing ? "Importing..." : "CSV Import"}
          </button>
        </div>
        {status && (
          <div style={{ padding: "0 14px 12px" }}>
            <span className="ib-meta">{status}</span>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div className="ib-window-tabs">
          {TIER_TABS.map((t) => (
            <button
              key={t.key}
              className={tierFilter === t.key ? "active" : ""}
              onClick={() => setTierFilter(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          className="ib-input"
          style={{ maxWidth: 220 }}
          placeholder="Filter by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ib-meta">{filtered.length} shown</span>
      </div>

      {/* Channel table */}
      <div className="ib-panel">
        <table className="ib-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>YouTube ID</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Tags</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ch) => (
              <tr key={ch.id}>
                <td>
                  <Link
                    href={`/ideation/ideas?tab=outliers&channel=${ch.id}`}
                    style={{ color: "var(--ib-text-bright)", textDecoration: "none" }}
                  >
                    {ch.title}
                  </Link>
                </td>
                <td className="ib-meta">{ch.youtube_channel_id}</td>
                <td>
                  <select
                    className="ib-select"
                    value={ch.priority_tier}
                    onChange={(e) => handleTierChange(ch.id, e.target.value as PriorityTier)}
                  >
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="ib-select"
                    value={ch.status}
                    onChange={(e) => handleStatusChange(ch.id, e.target.value as ChannelStatus)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {ch.topic_tags.length > 0
                    ? ch.topic_tags.map((tag) => (
                        <span key={tag} className="ib-tag" style={{ marginRight: 4 }}>
                          {tag}
                        </span>
                      ))
                    : <span className="ib-meta">--</span>}
                </td>
                <td className="ib-meta">{timeAgo(ch.created_at)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "var(--ib-text-dim)", textAlign: "center", padding: 30 }}>
                  {channels.length === 0 ? "No channels yet. Add one above." : "No channels match filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .ib-select {
          font-family: var(--ib-mono);
          font-size: 11px;
          padding: 3px 6px;
          background: var(--ib-bg);
          border: 1px solid var(--ib-border);
          color: var(--ib-text);
          cursor: pointer;
          outline: none;
        }
        .ib-select:hover {
          border-color: var(--ib-border-light);
        }
      `}</style>
    </div>
  );
}
