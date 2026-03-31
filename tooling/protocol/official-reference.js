import { loadValidatedJsonData } from "./json-data.js";
import { officialReferenceSourcesSchema } from "./official-reference-cache.js";

export const officialReferenceSources = loadValidatedJsonData(
  "./data/official-reference-sources.json",
  officialReferenceSourcesSchema,
  import.meta.url,
);

for (const source of officialReferenceSources.sources) {
  const url = new URL(source.url);

  if (!officialReferenceSources.cachePolicy.allowedOrigins.includes(url.origin)) {
    throw new Error(`Official reference source must use an allowed origin: ${source.url}`);
  }

  if (!officialReferenceSources.cachePolicy.includePathPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
    throw new Error(`Official reference source must use an allowed path prefix: ${source.url}`);
  }
}

export function listOfficialReferenceSources() {
  return [...officialReferenceSources.sources];
}

export function getOfficialReferenceCachePolicy() {
  return officialReferenceSources.cachePolicy;
}
