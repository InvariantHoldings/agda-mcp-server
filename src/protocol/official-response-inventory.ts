import { z } from "zod";
import { loadJsonData } from "../json-data.js";

export const officialResponseFamiliesSchema = z.object({
  responseKinds: z.array(z.string().min(1)).min(1),
  displayInfoKinds: z.array(z.string().min(1)).min(1),
  goalDisplayInfoKinds: z.array(z.string().min(1)).min(1),
});

export type OfficialResponseFamilies = z.infer<typeof officialResponseFamiliesSchema>;

export const officialResponseFamilies = loadJsonData(
  "./data/official-response-families.json",
  officialResponseFamiliesSchema,
  import.meta.url,
);

export function listOfficialResponseKinds(): string[] {
  return [...officialResponseFamilies.responseKinds];
}

export function listOfficialDisplayInfoKinds(): string[] {
  return [...officialResponseFamilies.displayInfoKinds];
}

export function listOfficialGoalDisplayInfoKinds(): string[] {
  return [...officialResponseFamilies.goalDisplayInfoKinds];
}
