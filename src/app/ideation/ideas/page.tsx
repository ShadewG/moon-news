import { ideationServerFetch } from "@/lib/ideation-api";
import type { IdeaRead, WatchlistChannelRead } from "@/lib/ideation-types";

import IdeasClient from "./ideas-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ideas — Ideation" };

export default async function IdeasPage() {
  const [ideas, channels] = await Promise.all([
    ideationServerFetch<IdeaRead[]>("/ideas"),
    ideationServerFetch<WatchlistChannelRead[]>("/watchlist"),
  ]);

  return <IdeasClient initialIdeas={ideas ?? []} channels={channels ?? []} />;
}
