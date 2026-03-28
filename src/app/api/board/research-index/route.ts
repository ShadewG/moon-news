import { NextResponse } from "next/server";
import { readdirSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const RESEARCH_DIR = path.resolve(process.cwd(), "research");

export async function GET() {
  let files: string[] = [];
  try {
    files = readdirSync(RESEARCH_DIR);
  } catch {
    return NextResponse.json({});
  }

  // Map slug → which output files exist
  const index: Record<string, { packet: boolean; writerPack: boolean; mediaScan: boolean; mediaCollector: boolean }> = {};

  for (const file of files) {
    const packetMatch = file.match(/^research-packet-(.+)\.json$/);
    if (packetMatch) {
      const slug = packetMatch[1];
      if (!index[slug]) index[slug] = { packet: false, writerPack: false, mediaScan: false, mediaCollector: false };
      index[slug].packet = true;
    }
    const writerMatch = file.match(/^writer-pack-(.+)\.json$/);
    if (writerMatch) {
      const slug = writerMatch[1];
      if (!index[slug]) index[slug] = { packet: false, writerPack: false, mediaScan: false, mediaCollector: false };
      index[slug].writerPack = true;
    }
    const mediaScanMatch = file.match(/^media-mission-scan-(.+)\.json$/);
    if (mediaScanMatch) {
      const slug = mediaScanMatch[1];
      if (!index[slug]) index[slug] = { packet: false, writerPack: false, mediaScan: false, mediaCollector: false };
      index[slug].mediaScan = true;
    }
    const mediaCollectorMatch = file.match(/^media-collector-(.+)\.json$/);
    if (mediaCollectorMatch) {
      const slug = mediaCollectorMatch[1];
      if (!index[slug]) index[slug] = { packet: false, writerPack: false, mediaScan: false, mediaCollector: false };
      index[slug].mediaCollector = true;
    }
  }

  return NextResponse.json(index);
}
