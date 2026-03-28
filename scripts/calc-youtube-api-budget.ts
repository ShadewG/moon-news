const DAILY_QUOTA_UNITS = 10_000;
const SEARCH_LIST_COST = 100;
const VIDEOS_LIST_COST = 1;
const SEARCH_INVOCATION_COST = SEARCH_LIST_COST + VIDEOS_LIST_COST;
const DEFAULT_SAFETY_MARGIN = 0.9;

function parseNumberArg(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const scriptsPerDay = parseNumberArg(process.argv[2], 100);
const reservedInvocations = parseNumberArg(process.argv[3], 20);
const safetyMargin = parseNumberArg(process.argv[4], DEFAULT_SAFETY_MARGIN);

const safeQuotaUnits = Math.floor(DAILY_QUOTA_UNITS * safetyMargin);
const safeInvocationsPerDay = Math.floor(safeQuotaUnits / SEARCH_INVOCATION_COST);
const availableForScriptAgent = Math.max(0, safeInvocationsPerDay - reservedInvocations);
const maxApiCallsPerScript =
  scriptsPerDay > 0 ? Number((availableForScriptAgent / scriptsPerDay).toFixed(2)) : 0;

console.log(
  JSON.stringify(
    {
      assumptions: {
        dailyQuotaUnits: DAILY_QUOTA_UNITS,
        searchListCost: SEARCH_LIST_COST,
        videosListCost: VIDEOS_LIST_COST,
        searchInvocationCost: SEARCH_INVOCATION_COST,
        safetyMargin,
        reservedInvocations,
      },
      outputs: {
        safeQuotaUnits,
        safeInvocationsPerDay,
        availableForScriptAgent,
        scriptsPerDay,
        maxApiCallsPerScript,
      },
      guidance: {
        interpretation:
          "If script-agent exceeds maxApiCallsPerScript on average, you should expect to hit YouTube API quota before the end of the day.",
        recommendedStrategy:
          "Keep YouTube API as the last fallback after local yt-dlp and web-search discovery. Reserve some budget for footage/visual search or channel lookups.",
      },
    },
    null,
    2
  )
);
