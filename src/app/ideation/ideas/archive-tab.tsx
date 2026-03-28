"use client";

import { useEffect, useState } from "react";

import { ideationGet } from "@/lib/ideation-client";

interface ArchiveWeek {
  week_key: string;
  start: string | null;
  end: string | null;
  total: number;
  approved: number;
  rejected: number;
}

export default function ArchiveTab() {
  const [weeks, setWeeks] = useState<ArchiveWeek[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await ideationGet<ArchiveWeek[]>("/ideas/archive");
      if (data) setWeeks(data);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="ib-meta" style={{ padding: 20 }}>Loading...</div>;

  return (
    <div>
      <div className="ib-meta" style={{ marginBottom: 10 }}>{weeks.length} week(s)</div>
      <table className="ib-table">
        <thead>
          <tr><th>Week</th><th>Range</th><th>Total</th><th>Approved</th><th>Rejected</th><th>Pending</th></tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const pending = w.total - w.approved - w.rejected;
            return (
              <tr key={w.week_key}>
                <td style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-text-dim)" }}>{w.week_key}</td>
                <td style={{ fontSize: 11 }}>
                  {w.start ? new Date(w.start).toLocaleDateString() : "—"} – {w.end ? new Date(w.end).toLocaleDateString() : "—"}
                </td>
                <td style={{ fontFamily: "var(--ib-mono)" }}>{w.total}</td>
                <td style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-positive-text)" }}>{w.approved}</td>
                <td style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-negative-text)" }}>{w.rejected}</td>
                <td style={{ fontFamily: "var(--ib-mono)", color: "var(--ib-text-dim)" }}>{pending}</td>
              </tr>
            );
          })}
          {weeks.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 30, color: "var(--ib-text-dim)" }}>No past idea generations yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
