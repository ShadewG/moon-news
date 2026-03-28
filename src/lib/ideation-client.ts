/**
 * Client-side fetch helpers for ideation API.
 * All calls go through the Next.js proxy at /api/ideation/*.
 */

const BASE = "/api/ideation";

export async function ideationGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function ideationPost<T>(path: string, body?: unknown, isFormData?: boolean): Promise<T | null> {
  try {
    const opts: RequestInit = { method: "POST" };
    if (isFormData && body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${path}`, opts);
    if (!res.ok) return null;
    if (res.status === 204) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function ideationPatch<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function ideationDelete(path: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

/* ── Formatting utilities ── */

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K";
  return String(n);
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return hours + "h";
  return Math.floor(hours / 24) + "d";
}

export function fmtScore(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  if (value >= 0.1) return value.toFixed(2);
  return value.toFixed(3);
}

export function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "—";
  if (secs >= 3600) return Math.floor(secs / 3600) + "h " + Math.floor((secs % 3600) / 60) + "m";
  return Math.floor(secs / 60) + "m " + (secs % 60) + "s";
}

export function fmtSegment(key: string | null | undefined): string {
  if (!key) return "—";
  const map: Record<string, string> = {
    short: "Short", live: "Live", "0-8m": "0–8m", "8-20m": "8–20m",
    "20m-2h": "20m–2h", "2h+": "2h+",
  };
  return map[key] ?? key;
}

export function ytThumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}
