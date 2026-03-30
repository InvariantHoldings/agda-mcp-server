import { z } from "zod";
import { loadValidatedJsonData } from "./json-data.js";

export const officialResponseFamiliesSchema = z.object({
  responseKinds: z.array(z.string().min(1)).min(1),
  displayInfoKinds: z.array(z.string().min(1)).min(1),
  goalDisplayInfoKinds: z.array(z.string().min(1)).min(1),
});

export const officialResponseFamilies = loadValidatedJsonData(
  "./data/official-response-families.json",
  officialResponseFamiliesSchema,
  import.meta.url,
);

export function listOfficialResponseKinds() {
  return [...officialResponseFamilies.responseKinds];
}

export function listOfficialDisplayInfoKinds() {
  return [...officialResponseFamilies.displayInfoKinds];
}

export function listOfficialGoalDisplayInfoKinds() {
  return [...officialResponseFamilies.goalDisplayInfoKinds];
}
