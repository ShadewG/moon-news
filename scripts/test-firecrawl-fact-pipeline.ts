import { writeFile } from "node:fs/promises";
import path from "node:path";

type SearchItem = {
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
};

type ExtractedFacts = {
  sourceTitle: string;
  keyFacts: string[];
  namedActors: string[];
  operationalDetails: string[];
  motiveFrames: string[];
  relationshipTurns: string[];
  deterrents: string[];
  exactQuotes: string[];
};

type BeatCheck = {
  label: string;
  description: string;
  patterns: RegExp[];
};

const SEARCH_QUERIES = [
  "Trump asked CIA assassinate Assange",
  "UC Global poisoning Assange car crash plot",
  "Julian Assange Lenin Moreno corruption embassy expulsion",
];

const BEAT_CHECKS: BeatCheck[] = [
  {
    label: "trump_direct_ask",
    description: "Trump directly asking whether Assange could be assassinated",
    patterns: [/trump/i, /assassinat/i],
  },
  {
    label: "poison_or_uc_global",
    description: "Poisoning idea or UC Global inside-man angle",
    patterns: [/poison/i, /uc global/i],
  },
  {
    label: "car_crash_detail",
    description: "Car-crash or vehicle-intercept detail",
    patterns: [/car/i, /crash|vehicle/i],
  },
  {
    label: "moreno_corruption_turn",
    description: "Lenin Moreno corruption / Ecuador turn against Assange",
    patterns: [/moreno/i, /corrupt|corruption|ina papers/i],
  },
  {
    label: "revenge_frame",
    description: "Revenge / retaliation / humiliation motive framing",
    patterns: [/revenge|retaliat/i, /embarrass|humiliat|punish/i],
  },
];

const articleFactSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceTitle: { type: "string" },
    keyFacts: { type: "array", items: { type: "string" } },
    namedActors: { type: "array", items: { type: "string" } },
    operationalDetails: { type: "array", items: { type: "string" } },
    motiveFrames: { type: "array", items: { type: "string" } },
    relationshipTurns: { type: "array", items: { type: "string" } },
    deterrents: { type: "array", items: { type: "string" } },
    exactQuotes: { type: "array", items: { type: "string" } },
  },
  required: [
    "sourceTitle",
    "keyFacts",
    "namedActors",
    "operationalDetails",
    "motiveFrames",
    "relationshipTurns",
    "deterrents",
    "exactQuotes",
  ],
} as const;

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

async function firecrawlSearch(query: string) {
  const response = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("FIRECRAWL_API_KEY")}`,
    },
    body: JSON.stringify({
      query,
      limit: 5,
      sources: ["web", "news"],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    data?: {
      web?: SearchItem[];
      news?: SearchItem[];
    };
  };

  if (!response.ok) {
    throw new Error(`Firecrawl search failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return {
    web: payload.data?.web ?? [],
    news: payload.data?.news ?? [],
  };
}

async function firecrawlScrape(url: string) {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("FIRECRAWL_API_KEY")}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    data?: {
      markdown?: string;
      metadata?: {
        title?: string;
        siteName?: string;
      };
    };
  };

  if (!response.ok) {
    throw new Error(`Firecrawl scrape failed (${response.status})`);
  }

  return {
    title: payload.data?.metadata?.title ?? "",
    siteName: payload.data?.metadata?.siteName ?? "",
    markdown: payload.data?.markdown?.trim() ?? "",
  };
}

async function extractFacts(url: string, markdown: string): Promise<ExtractedFacts> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      max_output_tokens: 1800,
      input: [
        {
          role: "system",
          content:
            "Extract the most decision-relevant documentary research facts from a scraped article. Preserve sharp specifics, names, motives, and operational details. Return strict JSON only.",
        },
        {
          role: "user",
          content: `Source URL: ${url}

Article markdown:
${markdown.slice(0, 24000)}

Extract named actors, operational details, motives, relationship turns, deterrents, and short exact quotes if present.`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "article_fact_extract",
          strict: true,
          schema: articleFactSchema,
        },
      },
    }),
  });

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        text?: string;
      }>;
    }>;
  };

  if (!response.ok) {
    throw new Error(`OpenAI extract failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const text =
    payload.output_text ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => typeof item.text === "string")
      .map((item) => item.text ?? "")
      .join("\n") ??
    "{}";

  return JSON.parse(text) as ExtractedFacts;
}

function dedupeUrls(items: SearchItem[]) {
  return [...new Set(items.map((item) => item.url).filter((url): url is string => Boolean(url)))];
}

function evaluateCoverage(extractions: Array<{ url: string; facts: ExtractedFacts }>) {
  const combined = extractions
    .map((item) => JSON.stringify(item.facts).toLowerCase())
    .join("\n\n");

  return BEAT_CHECKS.map((check) => ({
    label: check.label,
    description: check.description,
    covered: check.patterns.every((pattern) => pattern.test(combined)),
  }));
}

async function main() {
  const searchResults = await Promise.all(
    SEARCH_QUERIES.map(async (query) => ({
      query,
      results: await firecrawlSearch(query),
    }))
  );

  const candidateUrls = new Set<string>();
  for (const item of searchResults) {
    for (const url of dedupeUrls([...item.results.web, ...item.results.news]).slice(0, 3)) {
      candidateUrls.add(url);
    }
  }

  const extractions: Array<{
    url: string;
    title: string;
    siteName: string;
    facts: ExtractedFacts;
  }> = [];

  for (const url of candidateUrls) {
    try {
      const scraped = await firecrawlScrape(url);
      if (scraped.markdown.length < 1200) {
        continue;
      }

      const facts = await extractFacts(url, scraped.markdown);
      extractions.push({
        url,
        title: scraped.title,
        siteName: scraped.siteName,
        facts,
      });
    } catch (error) {
      extractions.push({
        url,
        title: "",
        siteName: "",
        facts: {
          sourceTitle: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
          keyFacts: [],
          namedActors: [],
          operationalDetails: [],
          motiveFrames: [],
          relationshipTurns: [],
          deterrents: [],
          exactQuotes: [],
        },
      });
    }
  }

  const coverage = evaluateCoverage(
    extractions.filter((item) => !item.facts.sourceTitle.startsWith("ERROR:"))
  );

  const report = {
    queries: searchResults,
    coverage,
    extractions,
  };

  const outPath = path.resolve(
    process.cwd(),
    "research",
    "firecrawl-fact-pipeline-assange.json"
  );
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(outPath);
  console.log(JSON.stringify(coverage, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
