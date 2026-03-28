"use client";

import { useEffect, useState } from "react";
import type { BoardBootstrapPayload } from "@/server/services/board";
import BoardClient from "./board-client";

export default function BoardLoader() {
  const [data, setData] = useState<BoardBootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/board/bootstrap")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Bootstrap failed: ${res.status}`);
        return res.json() as Promise<BoardBootstrapPayload>;
      })
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#555", fontFamily: "monospace", fontSize: 12 }}>
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#333", fontFamily: "monospace", fontSize: 11, gap: 8 }}>
        <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span>
        loading board…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <BoardClient data={data as Parameters<typeof BoardClient>[0]["data"]} />;
}
