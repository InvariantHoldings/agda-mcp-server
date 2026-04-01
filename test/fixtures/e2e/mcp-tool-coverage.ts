import { z } from "zod";

import { loadValidatedJsonData } from "../../helpers/json-data.js";

const e2eCoverageEntrySchema = z.object({
  tool: z.string(),
  suite: z.string(),
  scenario: z.string(),
  requiresLiveAgda: z.boolean(),
  requiresBackend: z.boolean().optional(),
});

export type E2eCoverageEntry = z.infer<typeof e2eCoverageEntrySchema>;

export const mcpToolCoverageMatrix: E2eCoverageEntry[] = loadValidatedJsonData(
  import.meta.dirname,
  "./mcp-tool-coverage.json",
  z.array(e2eCoverageEntrySchema),
);
