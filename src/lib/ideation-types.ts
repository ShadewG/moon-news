/* ── Dashboard ── */

export interface DashboardTopChannel {
  channel_id: number;
  title: string;
  video_count: number;
}

export interface DashboardSummary {
  window: string;
  monitored_channels: number;
  active_channels: number;
  observed_videos: number;
  recent_videos: number;
  ranked_outliers: number;
  top_channels: DashboardTopChannel[];
  hottest_clusters: string[];
}

export interface TrendClusterVideoRead {
  youtube_video_id: string;
  title: string;
  channel_title: string;
  thumbnail_url: string | null;
  latest_view_count: number | null;
  external_outlier_score: number;
  published_at: string;
}

export interface TrendClusterRead {
  label: string;
  heat: string;
  description: string;
  video_count: number;
  channel_count: number;
  avg_outlier_score: number;
  total_outlier_score: number;
  top_videos: TrendClusterVideoRead[];
}

/* ── Outliers ── */

export interface OutlierVideoRead {
  video_id: number;
  youtube_video_id: string;
  title: string;
  channel_id: number;
  channel_title: string;
  channel_category_id: string;
  channel_category_label: string;
  video_category_id: string;
  video_category_label: string;
  published_at: string;
  duration_seconds: number | null;
  latest_view_count: number | null;
  external_outlier_score: number;
  percentile_rank: number | null;
  segment_key: string | null;
  baseline_bucket_hours: number | null;
  requested_bucket_hours: number | null;
  bucket_fallback_used: boolean | null;
  views_ratio: number | null;
  window: string;
}

/* ── Ideas ── */

export interface IdeaSourceRead {
  video_id: number;
  youtube_video_id: string;
  video_title: string;
  channel_title: string;
  source_url: string;
  published_at: string;
  latest_view_count: number | null;
  outlier_score: number | null;
  percentile_rank: number | null;
  source_weight: number;
  evidence_note: string | null;
}

export interface IdeaRead {
  id: number;
  generation_window: string;
  window_start: string;
  window_end: string;
  title: string;
  angle: string;
  hook: string;
  why_now: string;
  what_pattern_it_copies: string;
  how_to_make_it_ours: string;
  target_format: string;
  title_options: string[];
  thumbnail_direction: string;
  confidence_score: number;
  our_channel_fit_score: number | null;
  idea_priority: number;
  status: string;
  evidence_summary: string | null;
  created_at: string;
  updated_at: string;
  sources: IdeaSourceRead[];
}

export interface IdeaGenerationJobRead {
  run_id: number;
  generation_window: string;
  status: string;
  provider: string;
  model_name: string;
  accepted_idea_count: number;
  iteration_count: number;
  preserved_existing_board: boolean;
  error: string | null;
  ideas: IdeaRead[];
}

/* ── Videos ── */

export interface VideoSnapshotRead {
  collected_at: string;
  video_age_hours: number;
  view_count: number;
  like_count: number | null;
  comment_count: number | null;
}

export interface VideoOutlierScoreRead {
  window: string;
  external_outlier_score: number;
  percentile_rank: number | null;
  computed_at: string;
}

export interface VideoListItem {
  id: number;
  youtube_video_id: string;
  title: string;
  channel_id: number;
  channel_title: string;
  channel_category_id: string;
  channel_category_label: string;
  video_category_id: string;
  video_category_label: string;
  published_at: string;
  duration_seconds: number | null;
  is_short: boolean;
  is_live: boolean;
  thumbnail_url: string | null;
  latest_view_count: number | null;
  outlier_score: number | null;
  outlier_percentile: number | null;
}

export interface VideoListResponse {
  items: VideoListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface VideoDetailRead {
  id: number;
  youtube_video_id: string;
  title: string;
  description: string | null;
  published_at: string;
  duration_seconds: number | null;
  is_short: boolean;
  is_live: boolean;
  thumbnail_url: string | null;
  source_url: string;
  channel_id: number;
  channel_title: string;
  channel_category_id: string;
  channel_category_label: string;
  video_category_id: string;
  video_category_label: string;
  snapshots: VideoSnapshotRead[];
  outlier_scores: VideoOutlierScoreRead[];
}

/* ── Research ── */

export interface ResearchBriefSummary {
  id: number;
  topic: string;
  status: string;
  has_brief: boolean;
  has_research: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResearchBriefRead {
  id: number;
  topic: string;
  status: string;
  brief_content: string | null;
  research_content: string | null;
  outline_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ExistingOutlineRead {
  source: string;
  source_id: string;
  title: string;
  slug: string;
  generated_at: string;
  has_brief: boolean;
  has_research: boolean;
  has_outline: boolean;
  section_count: number;
  clip_count: number;
  review_url: string | null;
}

export interface GenerationRunRead {
  id: number;
  run_type: string;
  provider: string;
  model_name: string;
  status: string;
  input_summary: string;
  error: string | null;
  created_at: string;
}

/* ── Watchlist ── */

export type PriorityTier = "priority" | "standard" | "low";
export type ChannelStatus = "active" | "paused";

export interface WatchlistChannelRead {
  id: number;
  title: string;
  youtube_channel_id: string;
  uploads_playlist_id: string | null;
  priority_tier: PriorityTier;
  status: ChannelStatus;
  topic_tags: string[];
  notes: string | null;
  primary_category_id: string;
  primary_category_label: string;
  created_at: string;
  updated_at: string;
}

export interface WatchlistImportResult {
  inserted_count: number;
  updated_count: number;
  channels: WatchlistChannelRead[];
  errors: string[];
}

export interface QuickAddChannelRead extends WatchlistChannelRead {
  videos_imported: number;
}

/* ── Settings ── */

export type IdeaProvider = "heuristic" | "anthropic";

export interface IdeaModelOption {
  id: string;
  label: string;
  provider: IdeaProvider;
  description: string;
  recommended: boolean;
}

export interface IdeaAgentSettingsRead {
  provider: IdeaProvider;
  model_name: string;
  max_iterations: number;
  min_accepted_ideas: number;
  thinking_budget_tokens: number;
  use_interleaved_thinking: boolean;
  anthropic_api_key_configured: boolean;
  updated_at: string | null;
  available_models: IdeaModelOption[];
}
