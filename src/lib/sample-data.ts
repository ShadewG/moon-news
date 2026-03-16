// ─── Domain status enums (matches backend schema) ───

export type JobStatus = "pending" | "queued" | "running" | "complete" | "failed" | "needs_review";

// Computed aggregate for UI display
export type AggregateStatus = "researched" | "in-progress" | "pending" | "footage-found" | "ready" | "error";

export function computeAggregateStatus(line: ScriptLine): AggregateStatus {
  if (line.research_status === "failed" || line.footage_status === "failed" || line.image_status === "failed" || line.video_status === "failed") return "error";
  if (line.research_status === "running" || line.footage_status === "running" || line.image_status === "running" || line.video_status === "running") return "in-progress";
  if (line.research_status === "queued" || line.footage_status === "queued" || line.image_status === "queued" || line.video_status === "queued") return "in-progress";
  if (line.footage_status === "complete") return "footage-found";
  if (line.research_status === "complete") return "researched";
  if (line.image_status === "complete" && line.video_status === "complete") return "ready";
  return "pending";
}

// ─── Project ───

export interface Project {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "in_progress" | "review" | "published";
  created_at: string;
  updated_at: string;
}

export interface ScriptVersion {
  id: string;
  project_id: string;
  version_number: number;
  raw_script: string;
  created_at: string;
}

// ─── Script Lines ───

export interface ScriptLine {
  id: string;
  project_id: string;
  script_version_id: string;
  line_key: string;
  line_index: number;
  timestamp_start_ms: number;
  duration_ms: number;
  text: string;
  line_type: "narration" | "quote" | "transition" | "headline";
  research_status: JobStatus;
  footage_status: JobStatus;
  image_status: JobStatus;
  video_status: JobStatus;
  line_content_category: LineContentCategory | null;
  classification_json: Record<string, unknown> | null;
}

export type LineContentCategory =
  | "concrete_event"
  | "named_person"
  | "abstract_concept"
  | "quote_claim"
  | "historical_period"
  | "transition"
  | "sample_story";

// Helper for display
export function formatTimestamp(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatDuration(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

// ─── Research ───

export interface ResearchRun {
  id: string;
  project_id: string;
  script_line_id: string;
  provider: "parallel";
  status: JobStatus;
  query: string;
  parallel_job_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export interface ResearchSource {
  id: string;
  research_run_id: string;
  script_line_id: string;
  title: string;
  source_name: string;
  source_url: string;
  published_at: string;
  snippet: string;
  extracted_text_path: string | null; // Firecrawl extracted text stored on volume
  relevance_score: number;
  source_type: "article" | "document" | "book" | "video" | "academic";
  citation_json: Record<string, string> | null;
}

export interface ResearchSummary {
  id: string;
  research_run_id: string;
  script_line_id: string;
  summary: string;
  confidence_score: number;
  model: string; // e.g. "gpt-4o"
}

export interface ResearchData {
  run: ResearchRun;
  sources: ResearchSource[];
  summary: ResearchSummary | null;
}

// ─── Footage ───

export interface FootageSearchRun {
  id: string;
  project_id: string;
  script_line_id: string;
  provider: "storyblocks" | "artlist";
  status: JobStatus;
  query: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export type MediaType = "video" | "image" | "stock_video" | "stock_image" | "article";
export type VisualProvider = "youtube" | "internet_archive" | "getty" | "google_images" | "storyblocks" | "artlist" | "twitter";

export interface FootageAsset {
  id: string;
  footage_search_run_id: string;
  script_line_id: string;
  provider: VisualProvider | string;
  media_type: MediaType;
  external_asset_id: string;
  title: string;
  preview_url: string | null;
  source_url: string;
  license_type: string | null;
  duration_ms: number;
  width: number;
  height: number;
  match_score: number;
  is_primary_source: boolean;
  upload_date: string | null;
  channel_or_contributor: string | null;
  score_breakdown_json: Record<string, unknown> | null;
  metadata_json: Record<string, unknown> | null;
  filtered: boolean;
  filter_reason: string | null;
}

export interface VisualRecommendation {
  id: string;
  project_id: string;
  script_line_id: string;
  recommendation_type: "ai_video" | "ai_image" | "stock_fallback";
  reason: string;
  suggested_prompt: string | null;
  suggested_style: string | null;
  confidence: number;
  dismissed: boolean;
}

export interface VisualsData {
  assets: FootageAsset[];
  recommendations: VisualRecommendation[];
}

// ─── Music ───

export interface MusicAsset {
  id: string;
  project_id: string;
  script_line_id: string | null; // null = project-level soundtrack
  provider: "artlist";
  external_asset_id: string;
  title: string;
  artist: string;
  preview_url: string;
  license_type: string;
  duration_ms: number;
  bpm: number | null;
  mood: string;
  genre: string;
  match_score: number;
}

// ─── Transcripts ───

export interface TranscriptJob {
  id: string;
  project_id: string;
  script_line_id: string;
  provider: "elevenlabs";
  status: JobStatus;
  input_media_path: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export interface Transcript {
  id: string;
  transcript_job_id: string;
  script_line_id: string;
  full_text: string;
  language_code: string;
  speaker_count: number;
  words_json: { word: string; start_ms: number; end_ms: number; speaker?: string }[];
  segments_json: { text: string; start_ms: number; end_ms: number; speaker?: string }[];
}

// ─── Generation ───

export interface ImageGenerationJob {
  id: string;
  project_id: string;
  script_line_id: string;
  provider: "openai" | "gemini";
  status: JobStatus;
  prompt: string;
  style_label: string;
  model: string;
  progress: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export interface VideoGenerationJob {
  id: string;
  project_id: string;
  script_line_id: string;
  provider: "openai";
  status: JobStatus;
  prompt: string;
  style_label: string;
  model: string;
  source_image_asset_id: string | null;
  progress: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export interface GeneratedAsset {
  id: string;
  project_id: string;
  script_line_id: string;
  job_type: "image" | "video";
  job_id: string;
  provider: "openai" | "gemini";
  asset_kind: "still" | "animation" | "clip";
  file_path: string;
  mime_type: string;
  duration_ms: number | null;
  width: number;
  height: number;
  metadata_json: Record<string, unknown> | null;
}

// ─── Timeline ───

export interface TimelineItem {
  id: string;
  project_id: string;
  script_line_id: string;
  track_type: "video" | "ai-image" | "ai-video" | "music" | "narration";
  asset_type: "footage" | "generated" | "music" | "audio";
  asset_id: string;
  start_ms: number;
  end_ms: number;
  layer_index: number;
  selected: boolean;
}

// ─── Export ───

export interface ExportJob {
  id: string;
  project_id: string;
  status: JobStatus;
  output_path: string | null;
  format: "mp4" | "mov" | "webm";
  resolution: "1080p" | "4K" | "720p";
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

// ─── Project Stats ───

export interface ProjectStats {
  totalLines: number;
  researchComplete: number;
  researchRunning: number;
  footageComplete: number;
  imagesGenerated: number;
  videosGenerated: number;
  transcriptsComplete: number;
  musicSelected: number;
  totalDurationMs: number;
  estimatedCost: string;
}

// ═══════════════════════════════════════════
// SAMPLE DATA
// ═══════════════════════════════════════════

export const sampleProject: Project = {
  id: "proj_01",
  title: "CIA Podcast Infiltration",
  slug: "cia-podcast-infiltration",
  status: "in_progress",
  created_at: "2026-03-10T14:00:00Z",
  updated_at: "2026-03-15T09:30:00Z",
};

export const sampleScriptVersion: ScriptVersion = {
  id: "sv_01",
  project_id: "proj_01",
  version_number: 2,
  raw_script: "", // omitted for brevity
  created_at: "2026-03-12T10:00:00Z",
};

export const sampleScript: ScriptLine[] = [
  {
    id: "line-1",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-1",
    line_index: 0,
    timestamp_start_ms: 0,
    duration_ms: 8000,
    text: "The CIA has been on every podcast you listen to. And no, that's not a conspiracy theory — it's a documented media strategy decades in the making.",
    line_type: "headline",
    research_status: "complete",
    footage_status: "complete",
    image_status: "complete",
    video_status: "running",
    line_content_category: null,
    classification_json: null,
  },
  {
    id: "line-2",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-2",
    line_index: 1,
    timestamp_start_ms: 8000,
    duration_ms: 12000,
    text: "In the 1950s, the agency launched Operation Mockingbird — a covert campaign to influence domestic and foreign media by recruiting journalists, editors, and media executives.",
    line_type: "narration",
    research_status: "complete",
    footage_status: "complete",
    image_status: "pending",
    video_status: "pending",
    line_content_category: null,
    classification_json: null,
  },
  {
    id: "line-3",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-3",
    line_index: 2,
    timestamp_start_ms: 20000,
    duration_ms: 10000,
    text: "Fast forward to 2002: the Pentagon deployed 'message force multipliers' — retired military analysts planted across TV networks to shape public opinion on the Iraq War.",
    line_type: "narration",
    research_status: "complete",
    footage_status: "complete",
    image_status: "complete",
    video_status: "queued",
    line_content_category: null,
    classification_json: null,
  },
  {
    id: "line-4",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-4",
    line_index: 3,
    timestamp_start_ms: 30000,
    duration_ms: 9000,
    text: "Today, podcasting has become the CIA's latest frontier. Former operatives are everywhere — Joe Rogan, Lex Fridman, Shawn Ryan Show, and dozens more.",
    line_type: "narration",
    research_status: "running",
    footage_status: "pending",
    image_status: "pending",
    video_status: "pending",
    line_content_category: null,
    classification_json: null,
  },
  {
    id: "line-5",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-5",
    line_index: 4,
    timestamp_start_ms: 39000,
    duration_ms: 11000,
    text: "\"Every podcast quote from a former CIA officer was read and approved by the CIA before you ever heard it.\" — CIA Prepublication Review Board requirement",
    line_type: "quote",
    research_status: "complete",
    footage_status: "running",
    image_status: "pending",
    video_status: "pending",
    line_content_category: null,
    classification_json: null,
  },
  {
    id: "line-6",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-6",
    line_index: 5,
    timestamp_start_ms: 50000,
    duration_ms: 10000,
    text: "John Kiriakou was imprisoned for exposing the CIA's torture programs. Now he appears across major podcasts with what critics call 'remarkable consistency' in his messaging.",
    line_type: "narration",
    research_status: "complete",
    footage_status: "complete",
    image_status: "running",
    video_status: "pending",
    line_content_category: null,
    classification_json: null,
  },
  {
    id: "line-7",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-7",
    line_index: 6,
    timestamp_start_ms: 60000,
    duration_ms: 9000,
    text: "Andrew Bustamante, former covert officer, repackages CIA recruitment tactics as self-help content through his 'EverydaySpy' platform — monetizing espionage for the masses.",
    line_type: "narration",
    research_status: "queued",
    footage_status: "pending",
    image_status: "pending",
    video_status: "pending",
    line_content_category: null,
    classification_json: null,
  },
  {
    id: "line-8",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-8",
    line_index: 7,
    timestamp_start_ms: 69000,
    duration_ms: 11000,
    text: "Mike Baker has appeared on Joe Rogan over 21 times. He openly admits to CIA interference in foreign elections while casually framing it as 'obvious' and unremarkable.",
    line_type: "narration",
    research_status: "running",
    footage_status: "pending",
    image_status: "pending",
    video_status: "pending",
    line_content_category: null,
    classification_json: null,
  },
  {
    id: "line-9",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-9",
    line_index: 8,
    timestamp_start_ms: 80000,
    duration_ms: 8000,
    text: "Intelligence analysts call this a 'limited hangout' — admit something controversial, but present it so casually that it loses its power to shock.",
    line_type: "narration",
    research_status: "pending",
    footage_status: "pending",
    image_status: "pending",
    video_status: "pending",
    line_content_category: null,
    classification_json: null,
  },
  {
    id: "line-10",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-10",
    line_index: 9,
    timestamp_start_ms: 88000,
    duration_ms: 10000,
    text: "The best way to hide a secret is to surround it with so much noise that no one can pick it out. That's not paranoia — that's information warfare.",
    line_type: "headline",
    research_status: "pending",
    footage_status: "pending",
    image_status: "pending",
    video_status: "pending",
    line_content_category: null,
    classification_json: null,
  },
  {
    id: "line-11",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-11",
    line_index: 10,
    timestamp_start_ms: 98000,
    duration_ms: 7000,
    text: "[TRANSITION: Cut to montage of podcast clips featuring former intelligence officers]",
    line_type: "transition",
    research_status: "pending",
    footage_status: "pending",
    image_status: "pending",
    video_status: "pending",
    line_content_category: null,
    classification_json: null,
  },
  {
    id: "line-12",
    project_id: "proj_01",
    script_version_id: "sv_01",
    line_key: "line-12",
    line_index: 11,
    timestamp_start_ms: 105000,
    duration_ms: 12000,
    text: "So the next time a former CIA officer shows up on your favorite podcast sounding reasonable, relatable, and refreshingly honest — ask yourself: who approved this message?",
    line_type: "headline",
    research_status: "pending",
    footage_status: "pending",
    image_status: "pending",
    video_status: "pending",
    line_content_category: null,
    classification_json: null,
  },
];

// ─── Research sample data (normalized) ───

export const sampleResearch: Record<string, ResearchData> = {
  "line-1": {
    run: {
      id: "rr_01",
      project_id: "proj_01",
      script_line_id: "line-1",
      provider: "parallel",
      status: "complete",
      query: "CIA media strategy podcasts influence operations documented history",
      parallel_job_id: "par_abc123",
      started_at: "2026-03-15T09:00:00Z",
      completed_at: "2026-03-15T09:00:47Z",
      error_message: null,
    },
    sources: [
      {
        id: "rs_01",
        research_run_id: "rr_01",
        script_line_id: "line-1",
        title: "CIA's Evolving Media Strategy: From Print to Podcasts",
        source_name: "The Intercept",
        source_url: "https://theintercept.com/cia-media-strategy",
        published_at: "2024-03-15",
        snippet: "Declassified documents reveal the CIA has systematically adapted its media influence operations for each new communication platform, from newspapers to radio, television, and now digital media including podcasts...",
        extracted_text_path: "/data/media/projects/proj_01/research-cache/rs_01.txt",
        relevance_score: 97,
        source_type: "article",
        citation_json: { apa: "The Intercept. (2024). CIA's Evolving Media Strategy." },
      },
      {
        id: "rs_02",
        research_run_id: "rr_01",
        script_line_id: "line-1",
        title: "Manufacturing Consent in the Digital Age",
        source_name: "Columbia Journalism Review",
        source_url: "https://cjr.org/digital-age-consent",
        published_at: "2024-01-22",
        snippet: "Media scholars have noted an unprecedented surge in former intelligence community members appearing across independent media platforms, raising questions about the boundary between transparency and strategic communication...",
        extracted_text_path: "/data/media/projects/proj_01/research-cache/rs_02.txt",
        relevance_score: 89,
        source_type: "academic",
        citation_json: null,
      },
      {
        id: "rs_03",
        research_run_id: "rr_01",
        script_line_id: "line-1",
        title: "The Intelligence Community's Public Relations Playbook",
        source_name: "Foreign Policy",
        source_url: "https://foreignpolicy.com/ic-pr-playbook",
        published_at: "2023-11-08",
        snippet: "Former directors have acknowledged that the intelligence community actively manages its public image through strategic media engagement, including podcast appearances...",
        extracted_text_path: null,
        relevance_score: 85,
        source_type: "article",
        citation_json: null,
      },
    ],
    summary: {
      id: "rsum_01",
      research_run_id: "rr_01",
      script_line_id: "line-1",
      summary: "Multiple credible sources confirm the CIA has a documented, evolving media influence strategy spanning decades. The agency has systematically adapted its approach from print media (Operation Mockingbird) through television to modern digital platforms including podcasts. Former intelligence officials' podcast appearances are subject to mandatory prepublication review, indicating institutional coordination rather than spontaneous transparency.",
      confidence_score: 94,
      model: "gpt-4o",
    },
  },
  "line-2": {
    run: {
      id: "rr_02",
      project_id: "proj_01",
      script_line_id: "line-2",
      provider: "parallel",
      status: "complete",
      query: "Operation Mockingbird CIA 1950s covert media influence journalists recruitment",
      parallel_job_id: "par_def456",
      started_at: "2026-03-15T09:01:00Z",
      completed_at: "2026-03-15T09:01:38Z",
      error_message: null,
    },
    sources: [
      {
        id: "rs_04",
        research_run_id: "rr_02",
        script_line_id: "line-2",
        title: "Operation Mockingbird: CIA Media Manipulation (Declassified)",
        source_name: "National Security Archive",
        source_url: "https://nsarchive.gwu.edu/mockingbird",
        published_at: "1975-04-26",
        snippet: "Church Committee hearings in 1975 revealed the CIA maintained relationships with over 50 U.S. journalists and media figures, including editors at major publications...",
        extracted_text_path: "/data/media/projects/proj_01/research-cache/rs_04.txt",
        relevance_score: 98,
        source_type: "document",
        citation_json: { apa: "Church Committee. (1975). Final Report, Book I." },
      },
      {
        id: "rs_05",
        research_run_id: "rr_02",
        script_line_id: "line-2",
        title: "The CIA and the Media: Carl Bernstein's Investigation",
        source_name: "Rolling Stone",
        source_url: "https://rollingstone.com/bernstein-cia-media",
        published_at: "1977-10-20",
        snippet: "Bernstein's landmark 1977 investigation revealed that more than 400 American journalists had carried out assignments for the Central Intelligence Agency over the previous 25 years...",
        extracted_text_path: "/data/media/projects/proj_01/research-cache/rs_05.txt",
        relevance_score: 95,
        source_type: "article",
        citation_json: null,
      },
      {
        id: "rs_06",
        research_run_id: "rr_02",
        script_line_id: "line-2",
        title: "Legacy of Ashes: The History of the CIA",
        source_name: "Tim Weiner — Doubleday",
        source_url: "https://books.example.com/legacy-of-ashes",
        published_at: "2007-06-22",
        snippet: "Weiner's Pulitzer Prize-winning history documents how the CIA recruited assets within every major American news organization during the Cold War era...",
        extracted_text_path: null,
        relevance_score: 91,
        source_type: "book",
        citation_json: null,
      },
    ],
    summary: {
      id: "rsum_02",
      research_run_id: "rr_02",
      script_line_id: "line-2",
      summary: "Operation Mockingbird is extensively documented through both declassified government records (Church Committee) and investigative journalism (Bernstein, Weiner). The program involved recruiting 400+ journalists and maintaining relationships with editors at every major U.S. publication. The scale of media infiltration during the Cold War era is well-established in the historical record.",
      confidence_score: 97,
      model: "gpt-4o",
    },
  },
  "line-3": {
    run: {
      id: "rr_03",
      project_id: "proj_01",
      script_line_id: "line-3",
      provider: "parallel",
      status: "complete",
      query: "Pentagon message force multipliers 2002 military analysts TV networks Iraq War",
      parallel_job_id: "par_ghi789",
      started_at: "2026-03-15T09:02:00Z",
      completed_at: "2026-03-15T09:02:42Z",
      error_message: null,
    },
    sources: [
      {
        id: "rs_07",
        research_run_id: "rr_03",
        script_line_id: "line-3",
        title: "Pentagon's 'Message Force Multiplier' Program Exposed",
        source_name: "New York Times",
        source_url: "https://nytimes.com/pentagon-analysts",
        published_at: "2008-04-20",
        snippet: "A 2008 NYT investigation by David Barstow revealed the Pentagon recruited over 75 retired military analysts to serve as TV commentators, secretly coordinating their talking points...",
        extracted_text_path: "/data/media/projects/proj_01/research-cache/rs_07.txt",
        relevance_score: 99,
        source_type: "article",
        citation_json: { apa: "Barstow, D. (2008). Behind TV Analysts, Pentagon's Hidden Hand. NYT." },
      },
      {
        id: "rs_08",
        research_run_id: "rr_03",
        script_line_id: "line-3",
        title: "DoD Inspector General Report on Media Analyst Program",
        source_name: "Department of Defense",
        source_url: "https://dodig.mil/reports/media-analysts",
        published_at: "2009-01-14",
        snippet: "The IG report found that the Pentagon provided retired military analysts with classified intelligence briefings and coordinated talking points before their television appearances...",
        extracted_text_path: "/data/media/projects/proj_01/research-cache/rs_08.txt",
        relevance_score: 94,
        source_type: "document",
        citation_json: null,
      },
    ],
    summary: {
      id: "rsum_03",
      research_run_id: "rr_03",
      script_line_id: "line-3",
      summary: "The Pentagon's 'message force multiplier' program is documented by a Pulitzer Prize-winning NYT investigation and a DoD Inspector General report. Over 75 retired military analysts were recruited as TV commentators with coordinated talking points, operating from 2002-2008 primarily around the Iraq War narrative.",
      confidence_score: 98,
      model: "gpt-4o",
    },
  },
  "line-5": {
    run: {
      id: "rr_05",
      project_id: "proj_01",
      script_line_id: "line-5",
      provider: "parallel",
      status: "complete",
      query: "CIA prepublication review board podcast appearances former officers approval requirement",
      parallel_job_id: "par_mno345",
      started_at: "2026-03-15T09:04:00Z",
      completed_at: "2026-03-15T09:04:35Z",
      error_message: null,
    },
    sources: [
      {
        id: "rs_09",
        research_run_id: "rr_05",
        script_line_id: "line-5",
        title: "CIA Prepublication Review Board: Rules and Controversies",
        source_name: "Lawfare Blog",
        source_url: "https://lawfaremedia.org/cia-prepub-review",
        published_at: "2023-09-14",
        snippet: "All current and former CIA employees must submit any public statements — including podcast appearances — to the CIA's Publications Review Board before dissemination...",
        extracted_text_path: "/data/media/projects/proj_01/research-cache/rs_09.txt",
        relevance_score: 96,
        source_type: "article",
        citation_json: null,
      },
      {
        id: "rs_10",
        research_run_id: "rr_05",
        script_line_id: "line-5",
        title: "Snepp v. United States (1980) — Prepublication Review Precedent",
        source_name: "Supreme Court Records",
        source_url: "https://supremecourt.gov/snepp-v-us",
        published_at: "1980-02-19",
        snippet: "The Supreme Court upheld the CIA's prepublication review requirement, establishing that former employees have a contractual obligation to submit all writings for review...",
        extracted_text_path: null,
        relevance_score: 92,
        source_type: "document",
        citation_json: null,
      },
    ],
    summary: {
      id: "rsum_05",
      research_run_id: "rr_05",
      script_line_id: "line-5",
      summary: "The CIA Prepublication Review Board requirement is legally established (Snepp v. United States, 1980) and applies to all former officers' public communications including podcast appearances. This is a factual, verifiable claim supported by Supreme Court precedent and current CIA policy.",
      confidence_score: 96,
      model: "gpt-4o",
    },
  },
  "line-6": {
    run: {
      id: "rr_06",
      project_id: "proj_01",
      script_line_id: "line-6",
      provider: "parallel",
      status: "complete",
      query: "John Kiriakou CIA whistleblower prison torture waterboarding podcast appearances",
      parallel_job_id: "par_pqr678",
      started_at: "2026-03-15T09:05:00Z",
      completed_at: "2026-03-15T09:05:41Z",
      error_message: null,
    },
    sources: [
      {
        id: "rs_11",
        research_run_id: "rr_06",
        script_line_id: "line-6",
        title: "John Kiriakou: The CIA Whistleblower Who Went to Prison",
        source_name: "The Guardian",
        source_url: "https://theguardian.com/kiriakou-whistleblower",
        published_at: "2015-02-09",
        snippet: "Kiriakou became the first CIA officer to publicly confirm the agency's use of waterboarding. He was subsequently charged under the Espionage Act and served 30 months in federal prison...",
        extracted_text_path: "/data/media/projects/proj_01/research-cache/rs_11.txt",
        relevance_score: 97,
        source_type: "article",
        citation_json: null,
      },
      {
        id: "rs_12",
        research_run_id: "rr_06",
        script_line_id: "line-6",
        title: "Doing Time Like a Spy: How the CIA Taught Me to Survive Prison",
        source_name: "John Kiriakou — Rare Bird Books",
        source_url: "https://books.example.com/doing-time-spy",
        published_at: "2017-04-11",
        snippet: "Kiriakou's memoir details his transition from CIA counterterrorism officer to federal prisoner, and his subsequent media career as a commentator on intelligence community affairs...",
        extracted_text_path: null,
        relevance_score: 88,
        source_type: "book",
        citation_json: null,
      },
    ],
    summary: {
      id: "rsum_06",
      research_run_id: "rr_06",
      script_line_id: "line-6",
      summary: "John Kiriakou's imprisonment for exposing CIA torture is well-documented. His subsequent prolific podcast presence and consistent messaging patterns are observable but the 'remarkable consistency' framing is editorial interpretation. The core facts (whistleblower, imprisonment, media presence) are strongly supported.",
      confidence_score: 91,
      model: "gpt-4o",
    },
  },
};

// ─── Footage sample data (with providers) ───

export const sampleFootage: Record<string, FootageAsset[]> = {
  "line-1": [
    {
      id: "fa_01",
      footage_search_run_id: "fsr_01",
      script_line_id: "line-1",
      provider: "youtube",
      media_type: "video",
      external_asset_id: "dQw4w9WgXcQ",
      title: "CIA Podcast Media Strategy — News Analysis",
      preview_url: null,
      source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      license_type: "YouTube Standard",
      duration_ms: 420000,
      width: 1920,
      height: 1080,
      match_score: 94,
      is_primary_source: false,
      upload_date: "2023-05-12",
      channel_or_contributor: "CBS News",
      score_breakdown_json: { relevanceScore: 48, mediaTypeBonus: 30, provenanceBonus: 10, dateBonus: 2, repostPenalty: 0 },
      metadata_json: { viewCount: 125000 },
      filtered: false,
      filter_reason: null,
    },
    {
      id: "fa_02",
      footage_search_run_id: "fsr_01",
      script_line_id: "line-1",
      provider: "storyblocks",
      media_type: "stock_video",
      external_asset_id: "sb_892341",
      title: "Podcast Studio Setup — Professional Recording",
      preview_url: null,
      source_url: "https://www.storyblocks.com/video/sb_892341",
      license_type: "Storyblocks License",
      duration_ms: 15000,
      width: 3840,
      height: 2160,
      match_score: 65,
      is_primary_source: false,
      upload_date: null,
      channel_or_contributor: null,
      score_breakdown_json: { relevanceScore: 45, mediaTypeBonus: 10, provenanceBonus: 5, dateBonus: 0, repostPenalty: 0 },
      metadata_json: null,
      filtered: false,
      filter_reason: null,
    },
    {
      id: "fa_03",
      footage_search_run_id: "fsr_02",
      script_line_id: "line-1",
      provider: "google_images",
      media_type: "image",
      external_asset_id: "gi_cia_langley_aerial",
      title: "CIA Headquarters — Langley Aerial View",
      preview_url: null,
      source_url: "https://example.com/cia-langley.jpg",
      license_type: null,
      duration_ms: 0,
      width: 2400,
      height: 1600,
      match_score: 78,
      is_primary_source: false,
      upload_date: null,
      channel_or_contributor: "Reuters",
      score_breakdown_json: { relevanceScore: 42, mediaTypeBonus: 20, provenanceBonus: 8, dateBonus: 0, repostPenalty: 0 },
      metadata_json: null,
      filtered: false,
      filter_reason: null,
    },
  ],
  "line-2": [
    {
      id: "fa_04",
      footage_search_run_id: "fsr_03",
      script_line_id: "line-2",
      provider: "internet_archive",
      media_type: "video",
      external_asset_id: "OperationMockingbird_1977",
      title: "Church Committee Hearing — Operation Mockingbird Testimony",
      preview_url: "https://archive.org/services/img/OperationMockingbird_1977",
      source_url: "https://archive.org/details/OperationMockingbird_1977",
      license_type: "Public Domain / Open",
      duration_ms: 1800000,
      width: 720,
      height: 480,
      match_score: 98,
      is_primary_source: true,
      upload_date: "1977",
      channel_or_contributor: "US Senate",
      score_breakdown_json: { relevanceScore: 50, mediaTypeBonus: 30, provenanceBonus: 20, dateBonus: 10, repostPenalty: 0 },
      metadata_json: { collection: "prelinger", description: "Senate Church Committee hearings on CIA domestic activities" },
      filtered: false,
      filter_reason: null,
    },
    {
      id: "fa_05",
      footage_search_run_id: "fsr_03",
      script_line_id: "line-2",
      provider: "youtube",
      media_type: "video",
      external_asset_id: "mockingbird_doc_yt",
      title: "Operation Mockingbird — CIA Media Control Documentary",
      preview_url: null,
      source_url: "https://www.youtube.com/watch?v=mockingbird_doc_yt",
      license_type: "YouTube Standard",
      duration_ms: 2700000,
      width: 1920,
      height: 1080,
      match_score: 85,
      is_primary_source: false,
      upload_date: "2019-03-15",
      channel_or_contributor: "The Documentary Network",
      score_breakdown_json: { relevanceScore: 47, mediaTypeBonus: 30, provenanceBonus: 10, dateBonus: 4, repostPenalty: 0 },
      metadata_json: { viewCount: 890000 },
      filtered: false,
      filter_reason: null,
    },
    {
      id: "fa_06",
      footage_search_run_id: "fsr_04",
      script_line_id: "line-2",
      provider: "storyblocks",
      media_type: "stock_video",
      external_asset_id: "sb_554821",
      title: "Vintage Newspaper Printing Press — 1950s",
      preview_url: null,
      source_url: "https://www.storyblocks.com/video/sb_554821",
      license_type: "Storyblocks License",
      duration_ms: 18000,
      width: 3840,
      height: 2160,
      match_score: 55,
      is_primary_source: false,
      upload_date: null,
      channel_or_contributor: null,
      score_breakdown_json: { relevanceScore: 40, mediaTypeBonus: 10, provenanceBonus: 5, dateBonus: 0, repostPenalty: 0 },
      metadata_json: null,
      filtered: false,
      filter_reason: null,
    },
  ],
  "line-3": [
    {
      id: "fa_07",
      footage_search_run_id: "fsr_05",
      script_line_id: "line-3",
      provider: "youtube",
      media_type: "video",
      external_asset_id: "pentagon_mfm_cspan",
      title: "Pentagon Message Force Multipliers — NYT Investigation",
      preview_url: null,
      source_url: "https://www.youtube.com/watch?v=pentagon_mfm_cspan",
      license_type: "YouTube Standard",
      duration_ms: 540000,
      width: 1920,
      height: 1080,
      match_score: 92,
      is_primary_source: false,
      upload_date: "2008-04-20",
      channel_or_contributor: "NYT Video",
      score_breakdown_json: { relevanceScore: 48, mediaTypeBonus: 30, provenanceBonus: 10, dateBonus: 10, repostPenalty: 0 },
      metadata_json: { viewCount: 250000 },
      filtered: false,
      filter_reason: null,
    },
    {
      id: "fa_08",
      footage_search_run_id: "fsr_06",
      script_line_id: "line-3",
      provider: "internet_archive",
      media_type: "video",
      external_asset_id: "IraqWar_CableNews_2003",
      title: "Iraq War 2003 — Cable News Coverage Compilation",
      preview_url: "https://archive.org/services/img/IraqWar_CableNews_2003",
      source_url: "https://archive.org/details/IraqWar_CableNews_2003",
      license_type: "Public Domain / Open",
      duration_ms: 3600000,
      width: 720,
      height: 480,
      match_score: 88,
      is_primary_source: true,
      upload_date: "2003",
      channel_or_contributor: "TV Archive",
      score_breakdown_json: { relevanceScore: 45, mediaTypeBonus: 30, provenanceBonus: 20, dateBonus: 10, repostPenalty: 0 },
      metadata_json: null,
      filtered: false,
      filter_reason: null,
    },
    {
      id: "fa_09",
      footage_search_run_id: "fsr_05",
      script_line_id: "line-3",
      provider: "google_images",
      media_type: "image",
      external_asset_id: "pentagon_aerial_ap",
      title: "Pentagon Building — Aerial View",
      preview_url: null,
      source_url: "https://example.com/pentagon-aerial.jpg",
      license_type: null,
      duration_ms: 0,
      width: 3840,
      height: 2160,
      match_score: 72,
      is_primary_source: false,
      upload_date: null,
      channel_or_contributor: "AP Images",
      score_breakdown_json: { relevanceScore: 44, mediaTypeBonus: 20, provenanceBonus: 8, dateBonus: 0, repostPenalty: 0 },
      metadata_json: null,
      filtered: false,
      filter_reason: null,
    },
  ],
  "line-6": [
    {
      id: "fa_10",
      footage_search_run_id: "fsr_07",
      script_line_id: "line-6",
      provider: "youtube",
      media_type: "video",
      external_asset_id: "kiriakou_cspan",
      title: "John Kiriakou — Senate Hearing Testimony (C-SPAN)",
      preview_url: null,
      source_url: "https://www.youtube.com/watch?v=kiriakou_cspan",
      license_type: "YouTube Standard",
      duration_ms: 320000,
      width: 1920,
      height: 1080,
      match_score: 99,
      is_primary_source: true,
      upload_date: "2014-09-17",
      channel_or_contributor: "C-SPAN",
      score_breakdown_json: { relevanceScore: 50, mediaTypeBonus: 30, provenanceBonus: 10, dateBonus: 7, repostPenalty: 0 },
      metadata_json: { viewCount: 450000 },
      filtered: false,
      filter_reason: null,
    },
    {
      id: "fa_11",
      footage_search_run_id: "fsr_08",
      script_line_id: "line-6",
      provider: "internet_archive",
      media_type: "video",
      external_asset_id: "SilencedDocumentary_2014",
      title: "Whistleblower Documentary — 'Silenced' (2014)",
      preview_url: "https://archive.org/services/img/SilencedDocumentary_2014",
      source_url: "https://archive.org/details/SilencedDocumentary_2014",
      license_type: "Public Domain / Open",
      duration_ms: 5400000,
      width: 1920,
      height: 1080,
      match_score: 94,
      is_primary_source: true,
      upload_date: "2014",
      channel_or_contributor: "James Spione",
      score_breakdown_json: { relevanceScore: 47, mediaTypeBonus: 30, provenanceBonus: 20, dateBonus: 7, repostPenalty: 0 },
      metadata_json: null,
      filtered: false,
      filter_reason: null,
    },
  ],
};

// ─── Music sample data ───

export const sampleMusic: Record<string, MusicAsset[]> = {
  "project": [
    {
      id: "ma_01",
      project_id: "proj_01",
      script_line_id: null,
      provider: "artlist",
      external_asset_id: "al_m_10234",
      title: "Dark Revelation",
      artist: "Ambient Waves",
      preview_url: "#",
      license_type: "Standard",
      duration_ms: 185000,
      bpm: 72,
      mood: "Dark, Suspenseful",
      genre: "Cinematic",
      match_score: 96,
    },
    {
      id: "ma_02",
      project_id: "proj_01",
      script_line_id: null,
      provider: "artlist",
      external_asset_id: "al_m_20891",
      title: "Echoes of Deception",
      artist: "The Score Project",
      preview_url: "#",
      license_type: "Standard",
      duration_ms: 210000,
      bpm: 85,
      mood: "Tense, Building",
      genre: "Documentary",
      match_score: 93,
    },
    {
      id: "ma_03",
      project_id: "proj_01",
      script_line_id: null,
      provider: "artlist",
      external_asset_id: "al_m_31456",
      title: "Under Surveillance",
      artist: "Noir Collective",
      preview_url: "#",
      license_type: "Standard",
      duration_ms: 156000,
      bpm: 68,
      mood: "Mysterious, Cold",
      genre: "Electronic",
      match_score: 90,
    },
    {
      id: "ma_04",
      project_id: "proj_01",
      script_line_id: null,
      provider: "artlist",
      external_asset_id: "al_m_42103",
      title: "Truth Serum",
      artist: "Glass Horizon",
      preview_url: "#",
      license_type: "Standard",
      duration_ms: 198000,
      bpm: 90,
      mood: "Urgent, Investigative",
      genre: "Cinematic",
      match_score: 88,
    },
  ],
};

// ─── Transcript sample data ───

export const sampleTranscripts: Record<string, { job: TranscriptJob; transcript: Transcript | null }> = {
  "line-6": {
    job: {
      id: "tj_01",
      project_id: "proj_01",
      script_line_id: "line-6",
      provider: "elevenlabs",
      status: "complete",
      input_media_path: "/data/media/projects/proj_01/uploads/kiriakou-hearing.mp4",
      started_at: "2026-03-15T09:10:00Z",
      completed_at: "2026-03-15T09:10:32Z",
      error_message: null,
    },
    transcript: {
      id: "t_01",
      transcript_job_id: "tj_01",
      script_line_id: "line-6",
      full_text: "I was the first CIA officer to publicly acknowledge that the agency was using torture. And for that, they put me in prison. Not for the torture itself — for talking about it.",
      language_code: "en",
      speaker_count: 1,
      words_json: [
        { word: "I", start_ms: 0, end_ms: 120 },
        { word: "was", start_ms: 140, end_ms: 280 },
        { word: "the", start_ms: 300, end_ms: 380 },
        { word: "first", start_ms: 400, end_ms: 620 },
        { word: "CIA", start_ms: 640, end_ms: 920 },
        { word: "officer", start_ms: 940, end_ms: 1200 },
      ],
      segments_json: [
        { text: "I was the first CIA officer to publicly acknowledge that the agency was using torture.", start_ms: 0, end_ms: 4200, speaker: "John Kiriakou" },
        { text: "And for that, they put me in prison.", start_ms: 4400, end_ms: 6800, speaker: "John Kiriakou" },
        { text: "Not for the torture itself — for talking about it.", start_ms: 7000, end_ms: 9800, speaker: "John Kiriakou" },
      ],
    },
  },
  "line-3": {
    job: {
      id: "tj_02",
      project_id: "proj_01",
      script_line_id: "line-3",
      provider: "elevenlabs",
      status: "running",
      input_media_path: "/data/media/projects/proj_01/uploads/pentagon-analysts-cspan.mp4",
      started_at: "2026-03-15T09:12:00Z",
      completed_at: null,
      error_message: null,
    },
    transcript: null,
  },
};

// ─── Image generation sample data ───

export const sampleImageJobs: Record<string, ImageGenerationJob[]> = {
  "line-1": [
    {
      id: "igj_01",
      project_id: "proj_01",
      script_line_id: "line-1",
      provider: "openai",
      status: "complete",
      prompt: "A dark, cinematic wide shot of a professional podcast studio with two microphones, faintly visible CIA seal reflected in the polished desk surface, moody blue lighting",
      style_label: "Cinematic Documentary",
      model: "dall-e-4",
      progress: 100,
      started_at: "2026-03-15T09:20:00Z",
      completed_at: "2026-03-15T09:20:18Z",
      error_message: null,
    },
    {
      id: "igj_02",
      project_id: "proj_01",
      script_line_id: "line-1",
      provider: "gemini",
      status: "complete",
      prompt: "Infographic-style illustration: podcast icons connected by glowing network lines to a central intelligence agency seal, dark background, data visualization aesthetic",
      style_label: "Motion Graphics Still",
      model: "imagen-3",
      progress: 100,
      started_at: "2026-03-15T09:20:30Z",
      completed_at: "2026-03-15T09:20:45Z",
      error_message: null,
    },
  ],
  "line-3": [
    {
      id: "igj_03",
      project_id: "proj_01",
      script_line_id: "line-3",
      provider: "openai",
      status: "complete",
      prompt: "Pentagon briefing room, retired military generals in suits reviewing papers before going on camera, warm overhead lighting, documentary photography style",
      style_label: "News Recreation",
      model: "dall-e-4",
      progress: 100,
      started_at: "2026-03-15T09:21:00Z",
      completed_at: "2026-03-15T09:21:15Z",
      error_message: null,
    },
  ],
  "line-6": [
    {
      id: "igj_04",
      project_id: "proj_01",
      script_line_id: "line-6",
      provider: "openai",
      status: "running",
      prompt: "Split composition: left side shows a man in a suit at a congressional hearing, right side shows the same figure behind prison bars, connected by a dividing line, documentary style",
      style_label: "Editorial Split",
      model: "dall-e-4",
      progress: 72,
      started_at: "2026-03-15T09:22:00Z",
      completed_at: null,
      error_message: null,
    },
  ],
};

// ─── Video generation sample data ───

export const sampleVideoJobs: Record<string, VideoGenerationJob[]> = {
  "line-1": [
    {
      id: "vgj_01",
      project_id: "proj_01",
      script_line_id: "line-1",
      provider: "openai",
      status: "running",
      prompt: "Slow cinematic push-in on a dark podcast studio, camera moves through a microphone revealing a ghostly CIA seal in the background, atmospheric lighting shifts from warm to cold blue",
      style_label: "Cinematic Documentary",
      model: "sora",
      source_image_asset_id: "ga_01",
      progress: 67,
      started_at: "2026-03-15T09:25:00Z",
      completed_at: null,
      error_message: null,
    },
  ],
  "line-3": [
    {
      id: "vgj_02",
      project_id: "proj_01",
      script_line_id: "line-3",
      provider: "openai",
      status: "queued",
      prompt: "Stylized recreation of a Pentagon briefing room, retired generals review papers then walk to a TV camera setup, documentary tone with subtle tension",
      style_label: "News Recreation",
      model: "sora",
      source_image_asset_id: "ga_03",
      progress: 0,
      started_at: null,
      completed_at: null,
      error_message: null,
    },
  ],
};

// ─── Timeline sample data ───

export const sampleTimeline: TimelineItem[] = [
  {
    id: "ti_01",
    project_id: "proj_01",
    script_line_id: "line-1",
    track_type: "video",
    asset_type: "footage",
    asset_id: "fa_02",
    start_ms: 0,
    end_ms: 8000,
    layer_index: 0,
    selected: true,
  },
  {
    id: "ti_02",
    project_id: "proj_01",
    script_line_id: "line-2",
    track_type: "video",
    asset_type: "footage",
    asset_id: "fa_04",
    start_ms: 8000,
    end_ms: 20000,
    layer_index: 0,
    selected: true,
  },
  {
    id: "ti_03",
    project_id: "proj_01",
    script_line_id: "line-3",
    track_type: "video",
    asset_type: "footage",
    asset_id: "fa_08",
    start_ms: 20000,
    end_ms: 30000,
    layer_index: 0,
    selected: true,
  },
  {
    id: "ti_04",
    project_id: "proj_01",
    script_line_id: "line-1",
    track_type: "ai-video",
    asset_type: "generated",
    asset_id: "vgj_01",
    start_ms: 0,
    end_ms: 8000,
    layer_index: 1,
    selected: false,
  },
  {
    id: "ti_05",
    project_id: "proj_01",
    script_line_id: "line-1",
    track_type: "ai-image",
    asset_type: "generated",
    asset_id: "igj_01",
    start_ms: 0,
    end_ms: 8000,
    layer_index: 2,
    selected: false,
  },
  {
    id: "ti_06",
    project_id: "proj_01",
    script_line_id: "line-1",
    track_type: "music",
    asset_type: "music",
    asset_id: "ma_01",
    start_ms: 0,
    end_ms: 117000,
    layer_index: 0,
    selected: true,
  },
  {
    id: "ti_07",
    project_id: "proj_01",
    script_line_id: "line-1",
    track_type: "narration",
    asset_type: "audio",
    asset_id: "narration_full",
    start_ms: 0,
    end_ms: 117000,
    layer_index: 0,
    selected: true,
  },
];

// ─── Project stats (computed) ───

export const projectStats: ProjectStats = {
  totalLines: 12,
  researchComplete: 5,
  researchRunning: 2,
  footageComplete: 4,
  imagesGenerated: 3,
  videosGenerated: 0,
  transcriptsComplete: 1,
  musicSelected: 1,
  totalDurationMs: 117000,
  estimatedCost: "$0 (Storyblocks + Artlist subscriptions)",
};
