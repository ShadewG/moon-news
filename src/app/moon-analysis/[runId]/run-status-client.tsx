"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import type { MoonAnalysisStatus } from "@/lib/moon-analysis";

const LIVE_STATUSES: MoonAnalysisStatus[] = ["pending", "queued", "running"];
const REFRESH_INTERVAL_MS = 10_000;

export default function MoonAnalysisRunStatusClient(props: { status: MoonAnalysisStatus }) {
  const router = useRouter();

  useEffect(() => {
    if (!LIVE_STATUSES.includes(props.status)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      router.refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [props.status, router]);

  return null;
}
