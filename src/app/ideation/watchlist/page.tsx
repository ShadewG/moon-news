import { ideationServerFetch } from "@/lib/ideation-api";
import type { WatchlistChannelRead } from "@/lib/ideation-types";

import WatchlistClient from "./watchlist-client";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const channels = await ideationServerFetch<WatchlistChannelRead[]>("/watchlist");

  return <WatchlistClient initialChannels={channels ?? []} />;
}
