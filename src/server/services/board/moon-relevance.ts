import "server-only";

/**
 * Moon's content verticals — derived from analyzing 63 videos over 3 months.
 * Used to classify stories and filter the board to show only Moon-relevant content.
 */
export const MOON_VERTICALS = [
  "Celebrity / Hollywood",
  "Podcast Reactions",
  "Tech Failures",
  "AI & Automation",
  "Big Tech / Billionaires",
  "Digital Rights / Piracy",
  "Scams & Fraud",
  "Social Issues / Culture",
  "Internet Drama",
  "Government / Corruption",
] as const;

export type MoonVertical = (typeof MOON_VERTICALS)[number];

/**
 * Keywords that signal a story fits Moon's content pillars.
 * Higher weight = stronger signal.
 */
const VERTICAL_SIGNALS: Record<MoonVertical, { keywords: string[]; weight: number }> = {
  "Celebrity / Hollywood": {
    keywords: [
      "hollywood", "celebrity", "actor", "actress", "movie", "film", "oscars",
      "netflix", "disney", "entertainment", "conan", "talk show", "red carpet",
      "scandal", "exposed", "predator", "harvey", "diddy", "epstein",
      "influencer", "onlyfans", "kardashian", "bieber", "kanye",
      "grooming", "abuse allegation", "metoo",
    ],
    weight: 1.0,
  },
  "Podcast Reactions": {
    keywords: [
      "joe rogan", "jre", "theo von", "lex fridman", "podcast", "interview",
      "andrew huberman", "tucker carlson", "steven bartlett", "diary of a ceo",
      "logan paul", "impaulsive", "flagrant", "shawn ryan",
    ],
    weight: 0.9,
  },
  "Tech Failures": {
    keywords: [
      "windows", "microsoft", "apple", "google", "spotify", "linkedin",
      "bug", "disaster", "failure", "broken", "worst update",
      "downfall", "decline", "failing", "dead product",
    ],
    weight: 0.85,
  },
  "AI & Automation": {
    keywords: [
      "ai replacing", "artificial intelligence", "automation", "chatgpt", "openai",
      "deepfake", "ai generated", "robot", "job loss", "ai danger",
      "sam altman", "ai ethics", "ai regulation", "grok", "claude",
      "ai scam", "ai fraud",
    ],
    weight: 0.9,
  },
  "Big Tech / Billionaires": {
    keywords: [
      "elon musk", "mark zuckerberg", "jeff bezos", "bill gates", "tim cook",
      "meta", "tesla", "spacex", "amazon", "google", "apple",
      "billionaire", "richest", "net worth", "monopoly", "antitrust",
      "dubai", "saudi", "wealth inequality",
    ],
    weight: 0.85,
  },
  "Digital Rights / Piracy": {
    keywords: [
      "piracy", "copyright", "dmca", "drm", "ownership", "buying isn't owning",
      "privacy", "surveillance", "encryption", "e2ee", "data breach",
      "right to repair", "subscription", "enshittification",
      "terms of service", "user data",
    ],
    weight: 0.9,
  },
  "Scams & Fraud": {
    keywords: [
      "scam", "fraud", "ponzi", "crypto scam", "rug pull", "nft",
      "coffeezilla", "exposed", "investigation", "money stolen",
      "fake", "con artist", "grifter",
    ],
    weight: 0.95,
  },
  "Social Issues / Culture": {
    keywords: [
      "gen z", "millennial", "incel", "dating", "loneliness", "mental health",
      "social media effect", "addiction", "culture war", "woke",
      "education", "student debt", "housing crisis", "job market",
      "simulation", "conspiracy",
    ],
    weight: 0.8,
  },
  "Internet Drama": {
    keywords: [
      "youtuber", "streamer", "twitch", "drama", "beef", "cancelled",
      "doxed", "exposed", "callout", "response video",
      "mrbeast", "pewdiepie", "dream", "sssniperwolf",
      "internet culture", "viral", "tiktok drama",
    ],
    weight: 0.85,
  },
  "Government / Corruption": {
    keywords: [
      "government", "corruption", "politician", "congress", "senate",
      "cia", "fbi", "nsa", "whistleblower", "classified",
      "cover up", "conspiracy", "propaganda", "censorship",
      "war", "military industrial",
    ],
    weight: 0.8,
  },
};

/**
 * Topics Moon does NOT cover — stories matching these get penalized.
 */
const IRRELEVANT_SIGNALS = [
  "stock price", "earnings report", "quarterly results", "ipo filing",
  "venture capital", "series a", "series b", "seed round", "fundraise",
  "sdk", "api update", "developer tools", "framework",
  "firmware update", "patch notes", "changelog",
  "recipe", "cooking", "restaurant review",
  "sports score", "game result", "playoff",
  "weather", "forecast",
  "product launch", "now available", "ships today", "pre-order",
  "deal alert", "percent off", "sale price", "best buy",
  "how to", "tutorial", "guide", "tips and tricks",
  "unboxing", "review:", "hands on",
  "press release",
];

export interface MoonRelevanceResult {
  vertical: MoonVertical | null;
  relevanceScore: number; // 0-100, how well this fits Moon's channel
  matchedKeywords: string[];
  irrelevantPenalty: number;
}

/**
 * Score how relevant a story is to Moon's content.
 * Returns the best-matching vertical and a relevance score.
 */
export function scoreMoonRelevance(
  title: string,
  summary?: string | null
): MoonRelevanceResult {
  const text = `${title} ${summary ?? ""}`.toLowerCase();

  let bestVertical: MoonVertical | null = null;
  let bestScore = 0;
  let bestKeywords: string[] = [];

  for (const [vertical, config] of Object.entries(VERTICAL_SIGNALS)) {
    const matched = config.keywords.filter((kw) => text.includes(kw));
    if (matched.length === 0) continue;

    const score = matched.length * 15 * config.weight;
    if (score > bestScore) {
      bestScore = score;
      bestVertical = vertical as MoonVertical;
      bestKeywords = matched;
    }
  }

  // Check for irrelevant content
  let irrelevantPenalty = 0;
  for (const signal of IRRELEVANT_SIGNALS) {
    if (text.includes(signal)) {
      irrelevantPenalty += 15;
    }
  }

  // Cap relevance score at 100
  const relevanceScore = Math.max(0, Math.min(100, bestScore - irrelevantPenalty));

  return {
    vertical: bestVertical,
    relevanceScore,
    matchedKeywords: bestKeywords,
    irrelevantPenalty,
  };
}

/**
 * Returns true if a story title is likely relevant to Moon's channel.
 * Quick filter for the board — stories below threshold get deprioritized.
 */
export function isMoonRelevant(title: string, summary?: string | null): boolean {
  const result = scoreMoonRelevance(title, summary);
  return result.relevanceScore >= 15;
}
