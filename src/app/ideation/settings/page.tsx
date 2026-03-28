import { ideationServerFetch } from "@/lib/ideation-api";
import type { IdeaAgentSettingsRead } from "@/lib/ideation-types";

import SettingsClient from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await ideationServerFetch<IdeaAgentSettingsRead>("/settings/idea-agent");

  return <SettingsClient initialSettings={settings} />;
}
