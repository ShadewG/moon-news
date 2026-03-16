import { NextResponse } from "next/server";
import { z } from "zod";

import { searchTopic } from "@/server/services/topic-search";

const searchSchema = z.object({
  query: z.string().min(2).max(200),
});

export async function POST(request: Request) {
  const body = await request.json();
  const { query } = searchSchema.parse(body);

  const result = await searchTopic(query);

  return NextResponse.json(result);
}
