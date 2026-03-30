import { loadValidatedJsonData } from "./json-data.js";
import { officialReferenceSourcesSchema } from "./official-reference-cache.js";

export const officialReferenceSources = loadValidatedJsonData(
  "./data/official-reference-sources.json",
  officialReferenceSourcesSchema,
  import.meta.url,
);

export function listOfficialReferenceSources() {
  return [...officialReferenceSources.sources];
}

export function getOfficialReferenceCachePolicy() {
  return officialReferenceSources.cachePolicy;
}
