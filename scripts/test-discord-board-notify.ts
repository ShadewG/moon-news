import { config } from "dotenv";

config({ path: ".env.local", override: false });
config({ path: ".env", override: false });

function getVisibilityScore(scoreJson: unknown) {
  if (!scoreJson || typeof scoreJson !== "object" || Array.isArray(scoreJson)) {
    return 0;
  }

  return typeof (scoreJson as { boardVisibilityScore?: unknown }).boardVisibilityScore === "number"
    ? ((scoreJson as { boardVisibilityScore: number }).boardVisibilityScore ?? 0)
    : 0;
}

async function main() {
  const { getBoardStoryDetail, listBoardStories } = await import(
    "../src/server/services/board"
  );
  const { sendDiscordChannelMessage } = await import(
    "../src/server/providers/discord"
  );
  const channelId = process.env.DISCORD_BOARD_CHANNEL_ID;
  if (!channelId) {
    throw new Error("DISCORD_BOARD_CHANNEL_ID is required");
  }

  const result = await listBoardStories({
    limit: 1,
    page: 1,
    timeWindow: "week",
    sort: "storyScore",
  });
  const story = result.stories[0];

  if (!story) {
    throw new Error("No board story available");
  }

  const detail = await getBoardStoryDetail(story.id);
  if (!detail) {
    throw new Error("No board detail available");
  }

  const whyNow =
    detail.aiOutputs.brief?.items
      ?.map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((item) => `• ${item}`)
      .join("\n") ||
    detail.sources.find((source) => source.summary)?.summary ||
    "New top board idea surfaced on the Moon board.";

  const sourceList =
    detail.sources
      .slice(0, 4)
      .map((source) => `• ${source.name} (${source.kind})`)
      .join("\n") || "No linked sources yet.";

  await sendDiscordChannelMessage({
    channelId,
    content: `Test board notification\n${process.env.APP_URL || "https://moon-internal.xyz"}/board`,
    embeds: [
      {
        title: detail.story.canonicalTitle,
        url: detail.sources[0]?.url || `${process.env.APP_URL || "https://moon-internal.xyz"}/board`,
        description: whyNow,
        color: 0x6d4aff,
        fields: [
          {
            name: "Board",
            value: [
              `Visibility ${getVisibilityScore(detail.story.scoreJson)}/100`,
              `Moon ${detail.story.moonFitScore}/100`,
              `Controversy ${detail.story.controversyScore}/100`,
              `Type ${detail.story.storyType}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "Format",
            value: [
              detail.formatRecommendation.packageLabel,
              `Primary ${detail.formatRecommendation.primaryFormat}`,
              `Urgency ${detail.formatRecommendation.urgency}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "Sources",
            value: sourceList,
          },
        ],
        footer: {
          text: `Moon board • ${process.env.APP_URL || "https://moon-internal.xyz"}/board`,
        },
        timestamp: detail.story.lastSeenAt || new Date().toISOString(),
      },
    ],
  });

  console.log(
    JSON.stringify(
      {
        sent: true,
        storyId: detail.story.id,
        title: detail.story.canonicalTitle,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
