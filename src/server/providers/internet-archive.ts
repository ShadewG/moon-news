import "server-only";

export interface InternetArchiveResult {
  identifier: string;
  title: string;
  description: string;
  mediaType: string;
  year: string | null;
  creator: string | null;
  collection: string | null;
  thumbnailUrl: string;
  sourceUrl: string;
  durationMs: number;
}

export async function searchInternetArchive(input: {
  keywords: string[];
  temporalContext: string | null;
  maxResults?: number;
}): Promise<{ results: InternetArchiveResult[] }> {
  const query = input.keywords.join(" ");
  const maxResults = input.maxResults ?? 10;

  const params = new URLSearchParams({
    q: `${query} AND mediatype:(movies OR image)`,
    output: "json",
    rows: String(maxResults),
    "fl[]": "identifier,title,description,mediatype,year,creator,collection",
    sort: "downloads desc",
  });

  // Note: don't filter by year — archival content about the 1950s may have been
  // uploaded decades later. The temporal context is used in the query keywords instead.

  const response = await fetch(
    `https://archive.org/advancedsearch.php?${params}`
  );

  if (!response.ok) {
    throw new Error(`Internet Archive search failed: ${response.status}`);
  }

  const data = await response.json() as {
    response: {
      docs: Array<{
        identifier: string;
        title?: string;
        description?: string | string[];
        mediatype?: string;
        year?: string;
        creator?: string | string[];
        collection?: string | string[];
      }>;
    };
  };

  const results: InternetArchiveResult[] = [];

  for (const doc of data.response.docs) {
    const description = Array.isArray(doc.description)
      ? doc.description[0] ?? ""
      : doc.description ?? "";
    const creator = Array.isArray(doc.creator)
      ? doc.creator[0] ?? null
      : doc.creator ?? null;
    const collection = Array.isArray(doc.collection)
      ? doc.collection[0] ?? null
      : doc.collection ?? null;

    let durationMs = 0;

    try {
      const metaResponse = await fetch(
        `https://archive.org/metadata/${doc.identifier}/files`
      );
      if (metaResponse.ok) {
        const metaData = await metaResponse.json() as {
          result?: Array<{ length?: string; format?: string }>;
        };
        const videoFile = metaData.result?.find(
          (f) =>
            f.format === "MPEG4" ||
            f.format === "h.264" ||
            f.format?.includes("Video")
        );
        if (videoFile?.length) {
          durationMs = parseFloat(videoFile.length) * 1000;
        }
      }
    } catch {
      // Metadata fetch is best-effort
    }

    results.push({
      identifier: doc.identifier,
      title: doc.title ?? doc.identifier,
      description: description.slice(0, 500),
      mediaType: doc.mediatype ?? "unknown",
      year: doc.year ?? null,
      creator,
      collection,
      thumbnailUrl: `https://archive.org/services/img/${doc.identifier}`,
      sourceUrl: `https://archive.org/details/${doc.identifier}`,
      durationMs,
    });
  }

  return { results };
}
