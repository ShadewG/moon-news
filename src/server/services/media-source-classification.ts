import "server-only";

type MediaSourceCandidate = {
  provider?: string | null;
  title?: string | null;
  sourceUrl?: string | null;
  channelOrContributor?: string | null;
};

const COMMENTARY_MARKERS = [
  /\bcommentary\b/i,
  /\bbreakdown\b/i,
  /\breaction\b/i,
  /\breacts?\b/i,
  /\brecap\b/i,
  /\bcompilation\b/i,
  /\bhighlights\b/i,
  /\bexplained\b/i,
  /\bexplainer\b/i,
  /\banalysis\b/i,
  /\breview\b/i,
  /\bvideo essay\b/i,
  /\bessay\b/i,
  /\bdeep dive\b/i,
  /\bmy thoughts\b/i,
  /\bthoughts on\b/i,
  /\bsaga\b/i,
  /\bdrama\b/i,
  /\bexposed\b/i,
  /\bwhat went wrong\b/i,
  /\bthe problem with\b/i,
  /\bthe truth about\b/i,
  /\bwhy nobody\b/i,
  /\bwhy no one\b/i,
  /\bwhy .* can't\b/i,
  /\bwhy .* cannot\b/i,
  /^why\b/i,
  /^how\b/i,
];

const PRIMARY_TITLE_MARKERS = [
  /\binterview\b/i,
  /\bfull interview\b/i,
  /\bpodcast\b/i,
  /\bfull episode\b/i,
  /\bappearance\b/i,
  /\bpress conference\b/i,
  /\bspeech\b/i,
  /\braw\b/i,
  /\blive\b/i,
  /\bhearing\b/i,
  /\btestimony\b/i,
  /\bdeposition\b/i,
  /\bdebate\b/i,
  /\btown hall\b/i,
  /\bpanel\b/i,
  /\bsegment\b/i,
  /\bmonologue\b/i,
  /\bweekend update\b/i,
  /\barchived?\b/i,
  /\bclip from\b/i,
];

const OFFICIAL_CHANNEL_MARKERS = [
  /\bnews\b/i,
  /\bpodcast\b/i,
  /\bradio\b/i,
  /\bofficial\b/i,
  /\bnetwork\b/i,
  /\barchive\b/i,
  /\bshow\b/i,
  /\bc-?span\b/i,
  /\bcnn\b/i,
  /\bmsnbc\b/i,
  /\bfox\b/i,
  /\babc\b/i,
  /\bcbs\b/i,
  /\bnbc\b/i,
  /\bbbc\b/i,
  /\bnpr\b/i,
  /\bpbs\b/i,
  /\breuters\b/i,
  /\bap\b/i,
  /\bassociated press\b/i,
  /\bguardian\b/i,
  /\btimes\b/i,
  /\bjoe rogan\b/i,
  /\bpowerfuljre\b/i,
  /\bhoward stern\b/i,
  /\blarry king\b/i,
  /\bconan\b/i,
  /\bteam coco\b/i,
  /\blate night\b/i,
  /\bnetflix is a joke\b/i,
];

const PROCEDURAL_MARKERS = [
  /\bdeposition\b/i,
  /\btrial\b/i,
  /\bhearing\b/i,
  /\btestimony\b/i,
  /\bcourt(room)?\b/i,
  /\blaw&crime\b/i,
];

function getHostname(url: string | null | undefined) {
  if (!url) {
    return "";
  }

  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function hasAnyPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function isLikelyPersonalChannel(channel: string) {
  if (!channel) {
    return false;
  }

  if (hasAnyPattern(channel, OFFICIAL_CHANNEL_MARKERS)) {
    return false;
  }

  if (/@|tv\b|media\b|network\b|podcast\b|radio\b|news\b|show\b/i.test(channel)) {
    return false;
  }

  const tokens = channel.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) {
    return false;
  }

  return tokens.every((token) => /^[A-Z][A-Za-z'-]+$/.test(token));
}

export function assessMediaSourceCandidate(candidate: MediaSourceCandidate) {
  const title = candidate.title?.trim() ?? "";
  const channel = candidate.channelOrContributor?.trim() ?? "";
  const label = `${title} ${channel}`.trim();
  const hostname = getHostname(candidate.sourceUrl);

  const isLikelyPrimary =
    hasAnyPattern(title, PRIMARY_TITLE_MARKERS) ||
    hasAnyPattern(channel, OFFICIAL_CHANNEL_MARKERS) ||
    hostname.includes("c-span.org") ||
    hostname.includes("npr.org") ||
    hostname.includes("pbs.org") ||
    hostname.includes("spotify.com") ||
    hostname.includes("podcasts.apple.com") ||
    hostname.includes("omny.fm") ||
    hostname.includes("megaphone.fm") ||
    hostname.includes("simplecast.com") ||
    hostname.includes("buzzsprout.com") ||
    hostname.includes("podbean.com");

  const hasCommentaryMarker = hasAnyPattern(label, COMMENTARY_MARKERS);
  const isLikelyProcedural = hasAnyPattern(label, PROCEDURAL_MARKERS);
  const isLikelyPersonalBrand = isLikelyPersonalChannel(channel);
  const isLikelyCommentary =
    (hasCommentaryMarker && !isLikelyPrimary) ||
    (candidate.provider === "youtube" &&
      isLikelyPersonalBrand &&
      !isLikelyPrimary &&
      !isLikelyProcedural);

  let scoreAdjustment = 0;
  if (isLikelyCommentary) {
    scoreAdjustment -= 40;
  } else if (hasCommentaryMarker) {
    scoreAdjustment -= 10;
  } else if (isLikelyPersonalBrand && !isLikelyPrimary) {
    scoreAdjustment -= 18;
  }
  if (isLikelyProcedural) {
    scoreAdjustment -= 16;
  }
  if (isLikelyPrimary) {
    scoreAdjustment += 18;
  }

  return {
    isLikelyCommentary,
    isLikelyPrimary,
    isLikelyProcedural,
    isLikelyPersonalBrand,
    scoreAdjustment,
  };
}

export function shouldExcludeCommentaryCandidate(candidate: MediaSourceCandidate) {
  return assessMediaSourceCandidate(candidate).isLikelyCommentary;
}
