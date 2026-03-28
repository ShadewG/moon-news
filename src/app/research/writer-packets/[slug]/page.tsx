import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import WriterPacketClient from "./writer-packet-client";

export const dynamic = "force-dynamic";

async function loadWriterPack(slug: string) {
  const filePath = path.resolve(process.cwd(), "research", `writer-pack-${slug}.json`);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    notFound();
  }
}

export default async function WriterPacketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const report = await loadWriterPack(slug);
  return <WriterPacketClient report={report} />;
}
