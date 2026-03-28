import { NextResponse } from "next/server";
import { z } from "zod";

import { listLibraryClips } from "@/server/services/clip-library";

const libraryQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  provider: z
    .enum(["all", "youtube", "twitter", "internet_archive"])
    .optional()
    .default("all"),
  sort: z.enum(["recent", "views", "quotes", "duration"]).optional().default("recent"),
  transcriptOnly: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  quoteOnly: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  moonOnly: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(96).optional().default(48),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = libraryQuerySchema.parse({
    q: url.searchParams.get("q") ?? undefined,
    provider: url.searchParams.get("provider") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    transcriptOnly: url.searchParams.get("transcriptOnly") ?? undefined,
    quoteOnly: url.searchParams.get("quoteOnly") ?? undefined,
    moonOnly: url.searchParams.get("moonOnly") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  const result = await listLibraryClips(params);

  return NextResponse.json(result);
}
