/**
 * Ingest all Moon YouTube videos into the clip library and transcribe them.
 * Run with: npx tsx scripts/ingest-moon-videos.ts
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and } from "drizzle-orm";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  clipLibrary,
  transcriptCache,
} from "../src/server/db/schema";

const execFileAsync = promisify(execFile);

const MOON_CHANNEL_ID = "UCmFeOdJI3IXgTBDzqBLD8qg";
const MOON_UPLOADS_PLAYLIST = "UUmFeOdJI3IXgTBDzqBLD8qg";
const MIN_DURATION_SECONDS = 120; // skip shorts

// ─── DB Setup ───

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

// ─── Transcript extraction ───

interface TranscriptSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

async function extractTranscript(videoId: string): Promise<TranscriptSegment[]> {
  const tmpFile = join(tmpdir(), `moon-transcript-${randomUUID()}`);
  const jsonPath = `${tmpFile}.en.json3`;

  try {
    await execFileAsync("yt-dlp", [
      "--write-auto-sub",
      "--sub-lang", "en",
      "--sub-format", "json3",
      "--skip-download",
      "--no-warnings",
      "--quiet",
      "-o", tmpFile,
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 30000 });

    const content = await readFile(jsonPath, "utf8");
    await unlink(jsonPath).catch(() => {});

    const data = JSON.parse(content) as {
      events?: Array<{
        tStartMs?: number;
        dDurationMs?: number;
        segs?: Array<{ utf8?: string }>;
      }>;
    };

    const segments: TranscriptSegment[] = [];
    for (const event of data.events ?? []) {
      if (!event.segs || event.tStartMs === undefined) continue;
      const text = event.segs
        .map((s) => s.utf8 ?? "")
        .join("")
        .replace(/\n/g, " ")
        .trim();
      if (!text) continue;
      segments.push({
        text,
        startMs: event.tStartMs,
        durationMs: event.dDurationMs ?? 0,
      });
    }

    return segments;
  } catch {
    await unlink(jsonPath).catch(() => {});
    return [];
  }
}

// ─── Main ───

async function main() {
  console.log("Fetching Moon's video list...");

  // Get all video IDs + metadata via yt-dlp
  const { stdout } = await execFileAsync("yt-dlp", [
    "--flat-playlist",
    "--print", "%(id)s|||%(title)s|||%(duration)s|||%(view_count)s|||%(upload_date)s",
    `https://www.youtube.com/playlist?list=${MOON_UPLOADS_PLAYLIST}`,
  ], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });

  const lines = stdout.trim().split("\n").filter(Boolean);
  console.log(`Found ${lines.length} total videos`);

  const videos = lines
    .map((line) => {
      const [id, title, dur, views, uploadDate] = line.split("|||");
      return {
        id,
        title,
        duration: parseInt(dur, 10) || 0,
        views: parseInt(views, 10) || 0,
        uploadDate: uploadDate !== "NA" ? uploadDate : null,
      };
    })
    .filter((v) => v.duration >= MIN_DURATION_SECONDS);

  console.log(`${videos.length} long-form videos (>=${MIN_DURATION_SECONDS}s)`);

  // Check which already exist in clip_library
  const existing = await db
    .select({ externalId: clipLibrary.externalId })
    .from(clipLibrary)
    .where(eq(clipLibrary.channelOrContributor, "Moon"));

  const existingIds = new Set(existing.map((e) => e.externalId));
  const newVideos = videos.filter((v) => !existingIds.has(v.id));
  const existingVideos = videos.filter((v) => existingIds.has(v.id));

  console.log(`${existingIds.size} already in library, ${newVideos.length} new to add`);

  // Insert new videos into clip_library
  if (newVideos.length > 0) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < newVideos.length; i += BATCH_SIZE) {
      const batch = newVideos.slice(i, i + BATCH_SIZE);
      await db.insert(clipLibrary).values(
        batch.map((v) => ({
          provider: "youtube" as const,
          externalId: v.id,
          title: v.title,
          sourceUrl: `https://www.youtube.com/watch?v=${v.id}`,
          previewUrl: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
          channelOrContributor: "Moon",
          durationMs: v.duration * 1000,
          viewCount: v.views,
          uploadDate: v.uploadDate,
          hasTranscript: false,
          metadataJson: {
            channelId: MOON_CHANNEL_ID,
            isMoonVideo: true,
          },
        }))
      ).onConflictDoNothing();
      console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} videos)`);
    }
  }

  // Now transcribe all videos that don't have transcripts yet
  const allMoonClips = await db
    .select({
      id: clipLibrary.id,
      externalId: clipLibrary.externalId,
      title: clipLibrary.title,
      hasTranscript: clipLibrary.hasTranscript,
    })
    .from(clipLibrary)
    .where(eq(clipLibrary.channelOrContributor, "Moon"));

  const needTranscript = allMoonClips.filter((c) => !c.hasTranscript);
  console.log(`\n${needTranscript.length} videos need transcripts`);

  let transcribed = 0;
  let failed = 0;

  for (const clip of needTranscript) {
    const num = `[${transcribed + failed + 1}/${needTranscript.length}]`;
    process.stdout.write(`${num} Transcribing: ${clip.title.substring(0, 50)}... `);

    try {
      const segments = await extractTranscript(clip.externalId);

      if (segments.length === 0) {
        console.log("NO TRANSCRIPT");
        failed++;
        continue;
      }

      const fullText = segments.map((s) => s.text).join(" ");
      const wordCount = fullText.split(/\s+/).length;

      // Insert transcript
      await db.insert(transcriptCache).values({
        clipId: clip.id,
        language: "en",
        fullText,
        segmentsJson: segments,
        wordCount,
      }).onConflictDoNothing();

      // Mark clip as having transcript
      await db
        .update(clipLibrary)
        .set({ hasTranscript: true, updatedAt: new Date() })
        .where(eq(clipLibrary.id, clip.id));

      transcribed++;
      console.log(`OK (${wordCount} words, ${segments.length} segments)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED: ${msg.substring(0, 60)}`);
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n=== DONE ===`);
  console.log(`Total Moon videos in library: ${allMoonClips.length + newVideos.length}`);
  console.log(`Transcribed this run: ${transcribed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Already had transcripts: ${allMoonClips.length - needTranscript.length}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
