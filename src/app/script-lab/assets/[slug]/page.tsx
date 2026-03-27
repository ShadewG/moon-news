import { notFound } from "next/navigation";

import { getEnv } from "@/server/config/env";
import AssetsDetailClient from "./assets-detail-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata(props: PageProps) {
  const { slug } = await props.params;
  const title = slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
  return { title: `${title} — Asset Report — Moon News` };
}

export default async function AssetReportDetailPage(props: PageProps) {
  const { slug } = await props.params;
  const ideationUrl = getEnv().IDEATION_BACKEND_URL;

  let data: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`${ideationUrl}/research/script-reports/${slug}.json`, {
      cache: "no-store",
    });
    if (!res.ok) {
      // Try the HTML endpoint to see if the report exists
      const htmlRes = await fetch(`${ideationUrl}/research/script-reports/${slug}`, {
        cache: "no-store",
      });
      if (!htmlRes.ok) notFound();
      // Report exists but no JSON — show a minimal view
      data = { scriptTitle: slug.replace(/-/g, " "), segments: [], segmentCount: 0 };
    } else {
      data = await res.json();
    }
  } catch {
    notFound();
  }

  if (!data) notFound();

  return <AssetsDetailClient data={data} slug={slug} />;
}
