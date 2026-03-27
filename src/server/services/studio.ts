import "server-only";

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { desc, eq, sql } from "drizzle-orm";

import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import {
  boardStoryAiOutputs,
  boardStoryCandidates,
  scriptLabRuns,
  scriptAgentRuns,
  scriptEdits,
  scriptFeedback,
} from "@/server/db/schema";

export interface StudioRunSummary {
  id: string;
  storyTitle: string;
  kind: "lab" | "agent";
  status: string;
  hasResult: boolean;
  createdAt: string;
  editStatus: string | null;
  openFeedbackCount: number;
  lastEditedAt: string | null;
}

export interface StudioResearchSummary {
  slug: string;
  title: string;
  generatedAt: string;
  updatedAt: string;
  hasPacket: boolean;
  hasWriterPack: boolean;
  hasMediaScan: boolean;
  hasMediaCollector: boolean;
  deepResearchStatus: string | null;
}

export interface StudioGenerationLink {
  label: string;
  href: string;
}

export interface StudioGenerationSummary {
  id: string;
  title: string;
  category: "script" | "research" | "brief" | "report";
  kind: string;
  status: string;
  statusBucket: "complete" | "running" | "failed";
  createdAt: string;
  updatedAt: string;
  href: string;
  subtitle: string;
  links: StudioGenerationLink[];
}

function scriptRunHref(run: Pick<StudioRunSummary, "id" | "kind">) {
  return run.kind === "agent" ? `/script-agent/${run.id}` : `/script-lab/${run.id}`;
}

/**
 * Lists all script runs (both lab and agent) combined, ordered by created_at desc.
 * Returns lightweight summaries with editorial status from LEFT JOINs.
 */
export async function listAllStudioRuns(): Promise<StudioRunSummary[]> {
  const db = getDb();

  // Subquery: latest edit per run
  const latestEdits = db
    .select({
      runId: scriptEdits.runId,
      editStatus: sql<string>`(
        SELECT se2.edit_status FROM script_edits se2
        WHERE se2.run_id = ${scriptEdits.runId}
        ORDER BY se2.version DESC LIMIT 1
      )`.as("edit_status"),
      lastEditedAt: sql<string>`max(${scriptEdits.updatedAt})`.as("last_edited_at"),
    })
    .from(scriptEdits)
    .groupBy(scriptEdits.runId)
    .as("latest_edits");

  // Subquery: open feedback count per run
  const openFeedbackCounts = db
    .select({
      runId: scriptFeedback.runId,
      openCount: sql<number>`count(*) filter (where not ${scriptFeedback.resolved})::int`.as("open_count"),
    })
    .from(scriptFeedback)
    .groupBy(scriptFeedback.runId)
    .as("open_fb");

  const [labRows, agentRows] = await Promise.all([
    db
      .select({
        id: scriptLabRuns.id,
        storyTitle: scriptLabRuns.storyTitle,
        hasResult: sql<boolean>`true`.as("has_result"),
        createdAt: scriptLabRuns.createdAt,
        editStatus: latestEdits.editStatus,
        lastEditedAt: latestEdits.lastEditedAt,
        openFeedbackCount: openFeedbackCounts.openCount,
      })
      .from(scriptLabRuns)
      .leftJoin(latestEdits, eq(latestEdits.runId, scriptLabRuns.id))
      .leftJoin(openFeedbackCounts, eq(openFeedbackCounts.runId, scriptLabRuns.id))
      .orderBy(desc(scriptLabRuns.createdAt)),
    db
      .select({
        id: scriptAgentRuns.id,
        storyTitle: scriptAgentRuns.storyTitle,
        status: scriptAgentRuns.status,
        hasResult: sql<boolean>`${scriptAgentRuns.resultJson} is not null`.as("has_result"),
        createdAt: scriptAgentRuns.createdAt,
        editStatus: latestEdits.editStatus,
        lastEditedAt: latestEdits.lastEditedAt,
        openFeedbackCount: openFeedbackCounts.openCount,
      })
      .from(scriptAgentRuns)
      .leftJoin(latestEdits, eq(latestEdits.runId, scriptAgentRuns.id))
      .leftJoin(openFeedbackCounts, eq(openFeedbackCounts.runId, scriptAgentRuns.id))
      .orderBy(desc(scriptAgentRuns.createdAt)),
  ]);

  const combined: StudioRunSummary[] = [
    ...labRows.map((row) => ({
      id: row.id,
      storyTitle: row.storyTitle,
      kind: "lab" as const,
      status: "complete",
      hasResult: true,
      createdAt: row.createdAt.toISOString(),
      editStatus: row.editStatus ?? null,
      openFeedbackCount: row.openFeedbackCount ?? 0,
      lastEditedAt: row.lastEditedAt ?? null,
    })),
    ...agentRows.map((row) => ({
      id: row.id,
      storyTitle: row.storyTitle,
      kind: "agent" as const,
      status: row.status,
      hasResult: row.hasResult,
      createdAt: row.createdAt.toISOString(),
      editStatus: row.editStatus ?? null,
      openFeedbackCount: row.openFeedbackCount ?? 0,
      lastEditedAt: row.lastEditedAt ?? null,
    })),
  ];

  combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return combined;
}

interface ResearchScanRow {
  slug: string;
  title: string;
  generatedAt: string;
  updatedAt: string;
  hasPacket: boolean;
  hasWriterPack: boolean;
  hasMediaScan: boolean;
  hasMediaCollector: boolean;
  deepResearchStatus: string | null;
}

function humanizeSlug(slug: string) {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function toStatusBucket(status: string): "complete" | "running" | "failed" {
  const normalized = status.toLowerCase();
  if (["complete", "completed", "brief"].includes(normalized)) return "complete";
  if (["running", "queued", "researching", "pending"].includes(normalized)) return "running";
  if (["failed", "error", "partial"].includes(normalized)) return "failed";
  return "failed";
}

type IdeationBriefSummary = {
  id: number;
  topic: string;
  status: string;
  has_brief: boolean;
  has_research: boolean;
  created_at: string;
  updated_at: string;
};

type IdeationScriptReportSummary = {
  slug: string;
  title: string;
  generatedAt: string;
  segmentCount: number;
  rawSegmentCount: number;
  editorUrl: string;
  htmlUrl: string | null;
};

async function fetchIdeationJson<T>(pathname: string): Promise<T | null> {
  try {
    const url = new URL(pathname, getEnv().IDEATION_BACKEND_URL);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function listAllStudioResearch(): Promise<StudioResearchSummary[]> {
  const researchDir = path.resolve(process.cwd(), "research");
  let fileNames: string[] = [];
  try {
    fileNames = readdirSync(researchDir);
  } catch {
    return [];
  }

  const grouped = new Map<string, ResearchScanRow>();

  for (const fileName of fileNames) {
    let slug: string | null = null;
    let kind: "packet" | "writerPack" | "mediaScan" | "mediaCollector" | null = null;
    if (fileName.startsWith("research-packet-") && fileName.endsWith(".json")) {
      slug = fileName.slice("research-packet-".length, -".json".length);
      kind = "packet";
    } else if (fileName.startsWith("writer-pack-") && fileName.endsWith(".json")) {
      slug = fileName.slice("writer-pack-".length, -".json".length);
      kind = "writerPack";
    } else if (fileName.startsWith("media-mission-scan-") && fileName.endsWith(".json")) {
      slug = fileName.slice("media-mission-scan-".length, -".json".length);
      kind = "mediaScan";
    } else if (fileName.startsWith("media-collector-") && fileName.endsWith(".json")) {
      slug = fileName.slice("media-collector-".length, -".json".length);
      kind = "mediaCollector";
    }

    if (!slug || !kind) continue;

    const filePath = path.resolve(researchDir, fileName);
    const updatedAt = statSync(filePath).mtime.toISOString();
    const existing = grouped.get(slug) ?? {
      slug,
      title: humanizeSlug(slug),
      generatedAt: updatedAt,
      updatedAt,
      hasPacket: false,
      hasWriterPack: false,
      hasMediaScan: false,
      hasMediaCollector: false,
      deepResearchStatus: null,
    };

    existing.updatedAt = existing.updatedAt > updatedAt ? existing.updatedAt : updatedAt;
    if (!existing.generatedAt || updatedAt < existing.generatedAt) {
      existing.generatedAt = updatedAt;
    }

    if (kind === "packet") existing.hasPacket = true;
    if (kind === "writerPack") existing.hasWriterPack = true;
    if (kind === "mediaScan") existing.hasMediaScan = true;
    if (kind === "mediaCollector") existing.hasMediaCollector = true;

    if (kind === "packet" || kind === "writerPack") {
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
          meta?: { title?: string; generatedAt?: string };
          discovery?: { deepResearch?: { status?: string | null } };
        };
        existing.title = parsed.meta?.title || existing.title;
        existing.generatedAt = parsed.meta?.generatedAt || existing.generatedAt;
        existing.deepResearchStatus = parsed.discovery?.deepResearch?.status || existing.deepResearchStatus;
      } catch {
        // Keep fallback metadata.
      }
    }

    grouped.set(slug, existing);
  }

  return Array.from(grouped.values())
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      generatedAt: row.generatedAt,
      updatedAt: row.updatedAt,
      hasPacket: row.hasPacket,
      hasWriterPack: row.hasWriterPack,
      hasMediaScan: row.hasMediaScan,
      hasMediaCollector: row.hasMediaCollector,
      deepResearchStatus: row.deepResearchStatus,
    }));
}

export async function listAllStudioGenerations(): Promise<StudioGenerationSummary[]> {
  const [runs, researches, ideationBriefs, ideationReports] = await Promise.all([
    listAllStudioRuns(),
    listAllStudioResearch(),
    fetchIdeationJson<IdeationBriefSummary[]>("/api/research"),
    fetchIdeationJson<IdeationScriptReportSummary[]>("/api/research/script-reports"),
  ]);

  const items: StudioGenerationSummary[] = [];

  for (const run of runs) {
    items.push({
      id: `${run.kind}:${run.id}`,
      title: run.storyTitle,
      category: "script",
      kind: run.kind === "agent" ? "agent_script" : "lab_script",
      status: run.status,
      statusBucket: toStatusBucket(run.status),
      createdAt: run.createdAt,
      updatedAt: run.lastEditedAt || run.createdAt,
      href: scriptRunHref(run),
      subtitle: run.kind === "agent" ? "Agent Pipeline script run" : "Script Lab run",
      links: [
        { label: "Open", href: scriptRunHref(run) },
      ],
    });
  }

  for (const research of researches) {
    const outputCount = [research.hasPacket, research.hasWriterPack, research.hasMediaScan, research.hasMediaCollector].filter(Boolean).length;
    const status = outputCount === 4 ? "complete" : outputCount > 0 ? "partial" : "failed";
    const links: StudioGenerationLink[] = [];
    if (research.hasPacket) links.push({ label: "Research Packet", href: `/research/packets/${research.slug}` });
    if (research.hasWriterPack) links.push({ label: "Writer Pack", href: `/research/writer-packets/${research.slug}` });
    if (research.hasMediaScan) links.push({ label: "Media Scan", href: `/research/media-mission-scan/${research.slug}` });
    if (research.hasMediaCollector) links.push({ label: "Media Collector", href: `/research/media-collector/${research.slug}` });
    items.push({
      id: `research:${research.slug}`,
      title: research.title,
      category: "research",
      kind: "topic_research",
      status,
      statusBucket: toStatusBucket(status),
      createdAt: research.generatedAt,
      updatedAt: research.updatedAt,
      href: links[0]?.href || `/research/packets/${research.slug}`,
      subtitle: `${outputCount}/4 research outputs${research.deepResearchStatus ? ` · deep research ${research.deepResearchStatus}` : ""}`,
      links,
    });
  }

  for (const brief of ideationBriefs || []) {
    const status = brief.has_research ? "complete" : brief.has_brief ? "brief" : brief.status;
    items.push({
      id: `brief:${brief.id}`,
      title: brief.topic,
      category: brief.has_research ? "research" : "brief",
      kind: brief.has_research ? "ideation_full_research" : "ideation_brief",
      status,
      statusBucket: toStatusBucket(brief.status),
      createdAt: brief.created_at,
      updatedAt: brief.updated_at,
      href: `/ideation#research-${brief.id}`,
      subtitle: brief.has_research ? "Ideation brief with full research" : brief.has_brief ? "Ideation research brief" : "Ideation research draft",
      links: [
        { label: brief.has_research ? "Open Research" : "Open Brief", href: `/ideation#research-${brief.id}` },
      ],
    });
  }

  for (const report of ideationReports || []) {
    const links: StudioGenerationLink[] = [];
    if (report.editorUrl) links.push({ label: "Editor", href: report.editorUrl });
    if (report.htmlUrl) links.push({ label: "HTML", href: report.htmlUrl });
    items.push({
      id: `report:${report.slug}`,
      title: report.title,
      category: "report",
      kind: "asset_report",
      status: "complete",
      statusBucket: "complete",
      createdAt: report.generatedAt,
      updatedAt: report.generatedAt,
      href: report.editorUrl || report.htmlUrl || `/ideation#generate`,
      subtitle: `${report.segmentCount} sections · ${report.rawSegmentCount} raw beats`,
      links,
    });
  }

  // Board deep-research briefs (from standalone research or board research)
  try {
    const db = getDb();
    const boardBriefs = await db
      .select({
        storyId: boardStoryAiOutputs.storyId,
        title: boardStoryCandidates.canonicalTitle,
        createdAt: boardStoryAiOutputs.createdAt,
        updatedAt: boardStoryAiOutputs.updatedAt,
      })
      .from(boardStoryAiOutputs)
      .innerJoin(
        boardStoryCandidates,
        eq(boardStoryAiOutputs.storyId, boardStoryCandidates.id)
      )
      .where(eq(boardStoryAiOutputs.kind, "brief"))
      .orderBy(desc(boardStoryAiOutputs.updatedAt));

    for (const brief of boardBriefs) {
      items.push({
        id: `board-brief:${brief.storyId}`,
        title: brief.title,
        category: "research",
        kind: "deep_research",
        status: "complete",
        statusBucket: "complete",
        createdAt: brief.createdAt.toISOString(),
        updatedAt: brief.updatedAt.toISOString(),
        href: `/board`,
        subtitle: "Deep research brief",
        links: [],
      });
    }
  } catch {
    // Non-critical — continue without board briefs
  }

  return items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
