import { z } from "zod";

import { loadValidatedJsonData } from "../helpers/json-data.js";

const releaseBugEntrySchema = z.object({
  issue: z.number().int().positive(),
  title: z.string().min(1),
  release: z.literal("0.6.2"),
  status: z.enum(["branch-fixed", "verified-live", "closed"]),
  localEvidence: z.array(z.string().min(1)).min(1),
  liveSuites: z.array(z.string().min(1)).min(1),
});

export type ReleaseBugEntry = z.infer<typeof releaseBugEntrySchema>;

export const releaseBugMatrix: ReleaseBugEntry[] = loadValidatedJsonData(
  import.meta.dirname,
  "./release-bug-matrix.json",
  z.array(releaseBugEntrySchema),
);
