import "server-only";

import { getEnv } from "@/server/config/env";

/**
 * Server-side fetch to the ideation FastAPI backend.
 * Used in page.tsx server components for initial data.
 * Fetches directly from localhost — no proxy needed.
 */
export async function ideationServerFetch<T>(path: string): Promise<T | null> {
  try {
    const base = getEnv().IDEATION_BACKEND_URL;
    const res = await fetch(`${base}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
