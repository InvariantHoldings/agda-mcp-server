import { z } from "zod";

import { loadValidatedJsonData } from "../../helpers/json-data.js";

const e2eCoverageEntrySchema = z.object({
  tool: z.string(),
  suite: z.string(),
  scenario: z.string(),
  requiresLiveAgda: z.boolean(),
  requiresBackend: z.boolean().optional(),
});

export const mcpToolCoverageMatrix = loadValidatedJsonData(
  import.meta.dirname,
  "./mcp-tool-coverage.json",
  z.array(e2eCoverageEntrySchema),
);
