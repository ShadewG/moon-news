import { ideationServerFetch } from "@/lib/ideation-api";

import AnalyticsClient from "./analytics-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Moon Stats — Ideation" };

interface VideoAnalytics {
  youtube_video_id: string;
  title: string;
  published_at: string | null;
  duration_seconds: number | null;
  views: number | null;
  estimated_minutes_watched: number | null;
  average_view_duration_seconds: number | null;
  average_view_percentage: number | null;
  likes: number | null;
  dislikes: number | null;
  comments: number | null;
  shares: number | null;
  subscribers_gained: number | null;
  subscribers_lost: number | null;
  net_subscribers: number | null;
}

interface ChannelInfo {
  channel_id: string;
  title: string;
  subscribers: number | null;
  video_count: number | null;
  total_views: number | null;
}

interface LocalStats {
  videos: number;
  daily_rows: number;
  traffic_rows: number;
  demographics_rows: number;
  geography_rows: number;
  latest_import: string | null;
}

interface Breakdowns {
  period: string;
  traffic: Array<{ source: string; views: number; estimated_minutes_watched: number }>;
  demographics: Array<{ age_group: string; gender: string; viewer_percentage: number }>;
  geography: Array<{ country: string; views: number; estimated_minutes_watched: number }>;
}

interface TrackedVideo {
  youtube_video_id: string;
  title: string;
  published_at: string;
  latest_view_count: number | null;
  duration_seconds: number | null;
}

interface DailyMetric {
  date: string;
  views: number;
  estimated_minutes_watched: number;
  subscribers_gained: number;
  subscribers_lost: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
}

export default async function AnalyticsPage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const dailyStart = thirtyDaysAgo.toISOString().slice(0, 10);
  const dailyEnd = now.toISOString().slice(0, 10);

  const [channelInfo, localStats, recentVideos, topVideos, breakdowns, trackedRecent, dailyData] = await Promise.all([
    ideationServerFetch<ChannelInfo>("/youtube-analytics/channel-info"),
    ideationServerFetch<LocalStats>("/youtube-analytics/local-stats"),
    ideationServerFetch<{ videos: VideoAnalytics[] }>("/youtube-analytics/local-videos?limit=30&sort=published_desc"),
    ideationServerFetch<{ videos: VideoAnalytics[] }>("/youtube-analytics/local-videos?limit=20&sort=views_desc"),
    ideationServerFetch<Breakdowns>("/youtube-analytics/local-breakdowns?period=last_30d"),
    // Also fetch from real-time video tracker (has latest uploads before analytics API catches up)
    ideationServerFetch<{ items: TrackedVideo[] }>("/videos?page=1&page_size=10&window=7d&channel_id=2"),
    // Daily channel metrics for sparklines
    ideationServerFetch<{ daily: DailyMetric[] }>(`/youtube-analytics/local-daily?start_date=${dailyStart}&end_date=${dailyEnd}`),
  ]);

  // Merge tracked videos that aren't in analytics yet
  const analyticsIds = new Set((recentVideos?.videos ?? []).map(v => v.youtube_video_id));
  const missingVideos: VideoAnalytics[] = (trackedRecent?.items ?? [])
    .filter(v => !analyticsIds.has(v.youtube_video_id))
    .map(v => ({
      youtube_video_id: v.youtube_video_id,
      title: v.title,
      published_at: v.published_at,
      duration_seconds: v.duration_seconds,
      views: v.latest_view_count,
      estimated_minutes_watched: null,
      average_view_duration_seconds: null,
      average_view_percentage: null,
      likes: null,
      dislikes: null,
      comments: null,
      shares: null,
      subscribers_gained: null,
      subscribers_lost: null,
      net_subscribers: null,
    }));

  const mergedRecent = [...missingVideos, ...(recentVideos?.videos ?? [])];

  return (
    <AnalyticsClient
      channelInfo={channelInfo}
      localStats={localStats}
      recentVideos={mergedRecent}
      topVideos={topVideos?.videos ?? []}
      breakdowns={breakdowns}
      dailyData={dailyData?.daily ?? []}
    />
  );
}
