import { loadJsonData } from "../json-data.js";
import {
  officialReferenceSourcesSchema,
  type OfficialReferenceCachePolicy,
  type OfficialReferenceSource,
  type OfficialReferenceSources,
} from "./official-reference-cache.js";

export const officialReferenceSources = loadJsonData(
  "./data/official-reference-sources.json",
  officialReferenceSourcesSchema,
  import.meta.url,
);

export type { OfficialReferenceCachePolicy, OfficialReferenceSource, OfficialReferenceSources };

export function listOfficialReferenceSources(): OfficialReferenceSource[] {
  return [...officialReferenceSources.sources];
}

export function getOfficialReferenceCachePolicy(): OfficialReferenceCachePolicy {
  return officialReferenceSources.cachePolicy;
}
