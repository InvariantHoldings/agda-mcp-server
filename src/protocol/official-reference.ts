import { z } from "zod";
import { loadJsonData } from "../json-data.js";

export const officialReferenceSourceSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  filename: z.string().min(1),
  description: z.string().min(1),
});

export const officialReferenceSourcesSchema = z.object({
  sources: z.array(officialReferenceSourceSchema),
});

export type OfficialReferenceSource = z.infer<typeof officialReferenceSourceSchema>;
export type OfficialReferenceSources = z.infer<typeof officialReferenceSourcesSchema>;

export const officialReferenceSources = loadJsonData(
  "./data/official-reference-sources.json",
  officialReferenceSourcesSchema,
  import.meta.url,
);

export function listOfficialReferenceSources(): OfficialReferenceSource[] {
  return [...officialReferenceSources.sources];
}
