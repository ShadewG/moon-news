import "server-only";

/**
 * Moon's content verticals — derived from analyzing 63 videos over 3 months.
 * Used to classify stories and filter the board to show only Moon-relevant content.
 *
 * KEY PRINCIPLE: Moon is a social commentary channel, NOT a tech/gadget channel.
 * Tech only matters when it affects PEOPLE — privacy violations, job losses,
 * corporate scandals, societal effects. Product launches, app updates, gadget
 * reviews, and routine business news are NOT Moon content.
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
 * IMPORTANT: Keywords should be specific enough that matching them
 * strongly suggests "Moon could make a 10-20 minute video about this."
 * Generic company names (apple, google, meta) are NOT enough —
 * they need to be paired with controversy/scandal/impact signals.
 */
const VERTICAL_SIGNALS: Record<MoonVertical, { keywords: string[]; weight: number }> = {
  "Celebrity / Hollywood": {
    keywords: [
      // Scandal / drama (Moon's angle on celebrities)
      "scandal", "exposed", "predator", "harvey", "diddy", "epstein",
      "grooming", "abuse", "allegation", "metoo", "arrested", "assault",
      "feud", "beef", "diss track", "controversy", "sued",
      // Specific people Moon covers
      "kardashian", "kanye", "drake", "kendrick", "taylor swift",
      "beyonce", "ice spice", "cardi b", "nicki minaj",
      "zendaya", "sydney sweeney", "jenna ortega",
      "mrbeast", "mr beast", "logan paul",
      "nikocado", "the rock", "dwayne johnson",
      "bieber", "justin bieber",
      // Entertainment industry drama (not reviews)
      "oscar controversy", "award snub", "box office bomb", "flop",
      "cancelled show", "streaming war", "hollywood strike",
      "tmz", "paparazzi", "shade room", "pop crave",
      "influencer", "onlyfans",
      // Real people in the news (not product news)
      "celebrity", "actor", "actress",
      // Moon's angle: dark side of fame
      "dark side", "secret life", "paid the price",
      "fooled everyone", "truth about",
    ],
    weight: 1.0,
  },
  "Podcast Reactions": {
    keywords: [
      "joe rogan", "jre", "theo von", "lex fridman", "podcast",
      "andrew huberman", "tucker carlson", "steven bartlett", "diary of a ceo",
      "logan paul", "impaulsive", "flagrant", "shawn ryan",
    ],
    weight: 0.9,
  },
  "Tech Failures": {
    // NOTE: This is about tech GOING WRONG, not tech existing.
    // "Apple released a new phone" = irrelevant. "Apple's update bricked millions of phones" = relevant.
    keywords: [
      "tech disaster", "massive bug", "catastrophic failure", "bricked",
      "worst update", "data loss", "outage millions",
      "downfall of", "decline of", "the fall of", "how.*killed",
      "dead product", "failed startup", "shutdown", "bankrupt",
      "class action", "antitrust lawsuit", "ftc sued",
    ],
    weight: 0.85,
  },
  "AI & Automation": {
    // AI as a SOCIETAL issue, not AI product announcements
    keywords: [
      "ai replacing", "ai took", "ai stealing", "ai job loss",
      "deepfake", "ai generated", "ai fraud", "ai scam",
      "ai danger", "ai existential", "ai alignment", "ai regulation",
      "ai ethics", "ai bias", "ai discrimination",
      "sam altman", "sued", "suing", "lawsuit",
      "openai scandal", "openai lawsuit", "openai fired", "openai sued",
      "ai art theft", "ai copyright", "ai plagiarism", "memorizing",
      "robot replacing", "automation job",
      "grok", "chatgpt",
      "sexualized", "csam", "ai image", "ai photo",
      "duped by ai", "fooled by ai",
      "backfiring", "catastroph",
      "ai is worse", "ai is destroying",
    ],
    weight: 0.9,
  },
  "Big Tech / Billionaires": {
    // Billionaire BEHAVIOR and corporate ABUSE, not business news
    keywords: [
      "elon musk", "zuckerberg", "jeff bezos", "bill gates",
      "billionaire", "richest", "wealth inequality", "tax evasion",
      "monopoly", "antitrust", "anti-competitive",
      "worker abuse", "union busting", "sweatshop",
      "ceo scandal", "golden parachute", "layoffs thousands",
      "corporate greed", "price gouging",
      "spacex explosion", "tesla recall", "tesla autopilot death",
      "deepfake", "manipulat", "accused",
      "trump", "kickback", "treasury",
    ],
    weight: 0.85,
  },
  "Digital Rights / Piracy": {
    keywords: [
      "piracy", "copyright strike", "dmca abuse", "drm",
      "buying isn't owning", "ownership",
      "privacy violation", "privacy", "surveillance", "spying on users",
      "encryption", "e2ee", "data breach", "data leak",
      "right to repair", "enshittification",
      "terms of service", "user data sold", "tracking",
      "censorship", "content moderation", "deplatformed",
      "kills encryption", "no longer private",
    ],
    weight: 0.9,
  },
  "Scams & Fraud": {
    keywords: [
      "scam", "fraud", "ponzi", "pyramid scheme",
      "crypto scam", "rug pull", "nft scam",
      "coffeezilla", "exposed", "investigation",
      "money stolen", "lost millions", "victims",
      "fake", "con artist", "grifter",
      "mlm", "multi-level marketing",
    ],
    weight: 0.95,
  },
  "Social Issues / Culture": {
    keywords: [
      // Gen Z / culture (Moon's core)
      "gen z", "millennial", "gen alpha",
      "incel", "dating crisis", "loneliness epidemic", "mental health crisis",
      "social media effect", "social media addiction", "brain rot",
      "culture war", "woke", "cancel culture",
      "student debt", "housing crisis", "cost of living crisis", "rent crisis",
      "nobody getting hired", "job market", "can't afford",
      // Viral cultural MOMENTS (not just any trending thing)
      "tiktok ban", "tiktok controversy", "tiktok",
      "boycott", "protest", "backlash",
      "fast fashion", "shein controversy", "temu",
      "ozempic", "beauty standard",
      "quiet quitting",
      // Reality TV / cultural moments
      "reality tv", "reality show", "mormon wives",
      "domestic assault", "domestic violence",
      "arrested", "charged with",
      // Societal critique patterns Moon uses
      "collapsing", "destroying", "worse than you thought",
      "epidemic", "addicted", "poisoned",
      "killing themselves", "suicide rate",
    ],
    weight: 0.8,
  },
  "Internet Drama": {
    keywords: [
      // Creator DRAMA, not just any creator content
      "youtuber", "streamer", "cancelled", "exposed",
      "doxed", "callout", "response video", "apology video",
      "drama", "beef", "controversy", "scandal",
      "mrbeast", "mr beast",
      "pewdiepie", "dream", "sssniperwolf",
      "influencer", "creator",
      "h3h3", "ethan klein", "keemstar",
      "kai cenat", "ishowspeed", "adin ross",
      "deplatformed", "ratio",
      "parasocial", "stan",
      "penguinz0", "critikal",
      "twitch", "banned", "illegal",
      "toxic workplace", "speak out", "without consent",
    ],
    weight: 0.85,
  },
  "Government / Corruption": {
    // Moon covers DARK government stories, not daily political news.
    // "The CIA is on every podcast" YES. "Trump says X" NO.
    // "Government secret database" YES. "Lawmakers react to X" NO.
    keywords: [
      // Deep state / conspiracy / dark ops
      "cia", "fbi secret", "nsa", "whistleblower", "classified", "leaked documents",
      "surveillance", "spying on citizens", "secret program",
      "war crime", "propaganda",
      "military industrial",
      "epstein", "trafficking", "cover up",
      // Corruption (systemic, not just "politician said X")
      "corruption", "bribery", "insider trading",
      "kickback", "embezzlement", "money laundering",
      // Government waste (Moon's angle: "your tax dollars at work")
      "taxpayer", "tax dollars", "government waste", "boondoggle",
      "bridge to nowhere", "over budget", "cost overrun",
      "unfinished", "ballooned", "mismanagement",
      "newsom", "gavin newsom",
      // Secret databases / surveillance state
      "secret database", "mass surveillance", "tracking citizens",
    ],
    weight: 0.8,
  },
};

/**
 * Topics Moon does NOT cover — stories matching these get HEAVILY penalized.
 * These are the "WhatsApp on Garmin" type stories that should never score high.
 */
const IRRELEVANT_SIGNALS = [
  // Product/gadget news (Moon doesn't do product reviews)
  "now available", "ships today", "pre-order", "hands on",
  "product launch", "officially available", "rolling out to",
  "new feature", "new update", "app update", "gets new",
  "unboxing", "review:", "first look:", "first impressions",
  "smartwatch", "wearable", "garmin", "fitbit",
  "phone case", "accessory", "charger",
  "spec", "benchmark", "geekbench",
  "megapixel", "refresh rate", "mah battery", "display size",

  // Routine business news
  "stock price", "earnings report", "quarterly results", "ipo filing",
  "venture capital", "series a", "series b", "seed round", "fundraise",
  "partnership announced", "teams up with", "joins forces",
  "appoints new", "hires", "promoted to", "steps down as",
  "expands to", "opens new office", "new headquarters",

  // Developer/enterprise tech (nobody watches Moon for this)
  "sdk", "api update", "developer tools", "framework",
  "open source", "github", "pull request", "repository",
  "firmware update", "patch notes", "changelog", "bug fix",
  "cloud service", "azure", "aws", "gcp",
  "enterprise", "b2b", "saas",
  "kubernetes", "docker", "devops",

  // Consumer deals / shopping
  "deal alert", "percent off", "sale price", "best buy",
  "amazon prime day", "black friday deal", "coupon",
  "cheapest", "budget pick", "best value",

  // How-to / tutorial content
  "how to", "tutorial", "step by step", "guide",
  "tips and tricks", "beginner's guide",

  // Movie/TV/entertainment product news (not scandals)
  "starts streaming", "now streaming", "coming to netflix",
  "first look:", "first trailer", "teaser trailer", "official trailer",
  "cast in", "has been cast", "joins cast", "casting news",
  "cinematography", "behind the scenes", "on set",
  "box office numbers", "opening weekend",
  "season premiere", "finale recap", "episode recap",
  "renewal", "renewed for", "picked up for",
  "film festival", "sundance", "cannes", "tiff",
  "red carpet", "fashion", "wore", "outfit", "dress",
  "award winner", "wins oscar", "wins emmy", "wins grammy",
  "slate", "lineup", "programming",

  // Viral fluff (not culturally significant)
  "went viral", "goes viral", "gone viral",
  "viral trend", "viral moment", "viral video",
  "wholesome", "heartwarming", "adorable",
  "life hack", "diy",

  // Individual Reddit/forum posts (not stories)
  "advice please", "any way to find", "help me",
  "is this a scam", "did i get scammed",
  "looking for recommendations",

  // Routine political news (Moon doesn't do daily political reporting)
  "lawmakers react", "senator introduces", "bill passes",
  "bipartisan", "filibuster", "committee hearing",
  "campaign trail", "polling", "approval rating",
  "primary election", "midterm", "caucus",
  "press secretary", "briefing",
  "diplomatic", "summit", "negotiations",
  "tariff", "trade deal", "trade war",
  "right wing", "left wing",
  "conservative", "liberal", "republican", "democrat",
  "foreign policy", "nato", "united nations",
  "world baseball", "olympics",

  // Generic non-commentary content
  "press release", "press conference",
  "recipe", "cooking", "restaurant review",
  "weather", "forecast",

  // Sports (unless it's cultural — use specific names for those)
  "sports score", "game result", "playoff", "standings",
  "touchdown", "home run", "goal scored",
  "transfer window", "free agent",

  // Routine tech coverage
  "carrier", "5g rollout", "network coverage",
  "browser update", "chrome update", "firefox update",
  "windows update", "macos update", "ios update",
  "pixel", "galaxy", "iphone",
  "laptop review", "tablet review",
  "printer", "router", "modem",
  "app store", "play store",
  "patent filed", "patent granted",
];

export interface PlatformSignals {
  sourceCount: number;
  controversyScore: number;
  sentimentMagnitude: number; // abs(sentiment) — stronger = more engagement
  hasTwitterDiscourse: boolean;
  hasYouTubeContent: boolean;
  hasMultipleSources: boolean;
}

export interface MoonRelevanceResult {
  vertical: MoonVertical | null;
  relevanceScore: number; // 0-100, how well this fits Moon's channel
  trendScore: number; // 0-100, how much this is trending/engaging
  combinedScore: number; // weighted blend of relevance + trend
  matchedKeywords: string[];
  irrelevantPenalty: number;
}

/**
 * Score how relevant a story is to Moon's content AND how much it's trending.
 *
 * The key test: "Could Moon make a 10-20 minute video about this?"
 * If the answer is no, the score should be low regardless of how
 * many keywords match.
 */
export function scoreMoonRelevance(
  title: string,
  summary?: string | null,
  platforms?: PlatformSignals | null
): MoonRelevanceResult {
  const text = `${title} ${summary ?? ""}`.toLowerCase();

  // ─── Irrelevant Content Check (run FIRST, penalize hard) ───
  let irrelevantPenalty = 0;
  for (const signal of IRRELEVANT_SIGNALS) {
    if (text.includes(signal)) {
      irrelevantPenalty += 20; // Heavier penalty per match
    }
  }

  // ─── Content Match Score ───
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

  // If only 1 keyword matched, reduce score slightly
  // (two+ keyword matches = much stronger signal)
  if (bestKeywords.length === 1) {
    bestScore = Math.round(bestScore * 0.7);
  }

  const relevanceScore = Math.max(0, Math.min(100, bestScore - irrelevantPenalty));

  // ─── Trend / Platform Engagement Score ───
  let trendScore = 0;
  if (platforms) {
    trendScore += Math.min(platforms.sourceCount * 8, 25);
    trendScore += Math.min(Math.round(platforms.controversyScore * 0.25), 25);
    trendScore += Math.min(Math.round(platforms.sentimentMagnitude * 15), 15);
    if (platforms.hasTwitterDiscourse) trendScore += 15;
    if (platforms.hasYouTubeContent) trendScore += 10;
    if (platforms.hasMultipleSources) trendScore += 10;
  } else {
    // No platform data — only boost for STRONG signals
    const emotionWords = ["exposed", "destroyed", "shocking", "breaking", "scandal",
      "disaster", "catastroph", "millions", "arrested", "sued", "banned",
      "leaked", "secret", "warning", "emergency", "crisis"];
    const emotionMatches = emotionWords.filter((w) => text.includes(w));
    trendScore += emotionMatches.length * 10;

    const namePatterns = ["elon", "zuckerberg", "altman", "gates", "bezos",
      "trump", "rogan", "musk", "diddy", "drake", "kanye", "kardashian"];
    const nameMatches = namePatterns.filter((n) => text.includes(n));
    trendScore += nameMatches.length * 12;
  }

  trendScore = Math.min(100, trendScore);

  // ─── Combined Score ───
  // 70% content relevance + 30% trending (was 60/40 — relevance matters more)
  // Totally irrelevant topics get capped hard
  const combinedScore = relevanceScore > 0
    ? Math.round(relevanceScore * 0.7 + trendScore * 0.3)
    : Math.round(trendScore * 0.1); // Irrelevant topics get max 10 from trend alone (was 20)

  return {
    vertical: bestVertical,
    relevanceScore,
    trendScore,
    combinedScore,
    matchedKeywords: bestKeywords,
    irrelevantPenalty,
  };
}

/**
 * Returns true if a story title is likely relevant to Moon's channel.
 * Quick filter for the board — stories below threshold get deprioritized.
 */
export function isMoonRelevant(title: string, summary?: string | null): boolean {
  const result = scoreMoonRelevance(title, summary, null);
  return result.combinedScore >= 15;
}
