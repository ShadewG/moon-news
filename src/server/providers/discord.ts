import "server-only";

import { requireEnv } from "@/server/config/env";

const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

function truncateDiscordText(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeEmbed(embed: DiscordEmbed): DiscordEmbed {
  return {
    ...embed,
    title: embed.title ? truncateDiscordText(embed.title, 256) : undefined,
    description: embed.description
      ? truncateDiscordText(embed.description, 4096)
      : undefined,
    fields: embed.fields?.slice(0, 25).map((field) => ({
      name: truncateDiscordText(field.name, 256),
      value: truncateDiscordText(field.value, 1024),
      inline: field.inline,
    })),
    footer: embed.footer
      ? { text: truncateDiscordText(embed.footer.text, 2048) }
      : undefined,
  };
}

export async function sendDiscordChannelMessage(args: {
  channelId: string;
  content?: string;
  embeds?: DiscordEmbed[];
}) {
  const token = requireEnv("DISCORD_BOT_TOKEN");
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${args.channelId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${token}`,
      },
      body: JSON.stringify({
        content: args.content ? truncateDiscordText(args.content, 2000) : undefined,
        embeds: args.embeds?.map(normalizeEmbed),
        allowed_mentions: { parse: [] },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Discord API request failed (${response.status}): ${truncateDiscordText(body, 400)}`
    );
  }

  return response.json();
}
