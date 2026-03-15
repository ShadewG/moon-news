import "server-only";

export interface GettyResult {
  assetId: string;
  title: string;
  caption: string;
  previewUrl: string;
  sourceUrl: string;
  collection: string;
  dateCreated: string | null;
  artist: string | null;
  width: number;
  height: number;
}

export async function searchGetty(input: {
  keywords: string[];
  temporalContext: string | null;
  maxResults?: number;
}): Promise<{ results: GettyResult[] }> {
  // Stub: Getty API requires commercial access.
  // Will integrate when API credentials are obtained.
  return { results: [] };
}
