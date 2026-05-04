// MIT License — see LICENSE
//
// Representative invocations for each MCP tool family (manifest
// category). Lets agents discover canonical "how do I use this
// family?" examples through `agda_tools_catalog` without having to
// reverse-engineer call shapes from the input schema alone.
//
// The static example table lives in
// `src/tools/data/tool-family-examples.json` so the SSOT is a JSON
// asset, validated at module-init via Zod and decoupled from this
// loader logic. Adding a new family or example only requires a JSON
// edit; the catalog/parity surfaces pick it up automatically.

import { z } from "zod";

import { loadJsonData } from "../json-data.js";
import type { ToolCategory } from "./manifest.js";

const toolFamilyExampleSchema = z.object({
  tool: z.string().min(1),
  summary: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  note: z.string().optional(),
});

export type ToolFamilyExample = z.infer<typeof toolFamilyExampleSchema>;

const toolFamilyExamplesFileSchema = z.object({
  $comment: z.string().optional(),
  families: z.record(z.string(), z.array(toolFamilyExampleSchema)),
});

const RAW = loadJsonData(
  "./data/tool-family-examples.json",
  toolFamilyExamplesFileSchema,
  import.meta.url,
);

const FAMILY_EXAMPLES: ReadonlyMap<string, ReadonlyArray<ToolFamilyExample>> =
  new Map(Object.entries(RAW.families));

/**
 * Returns the representative examples declared for a given tool
 * family (manifest category). Returns an empty array for families
 * with no declared examples — callers should treat that as
 * "no curated examples yet" rather than an error.
 */
export function getToolFamilyExamples(category: ToolCategory): ToolFamilyExample[] {
  return [...(FAMILY_EXAMPLES.get(category) ?? [])];
}

/**
 * Returns every declared family → examples mapping. Categories
 * without examples are omitted, so the consumer sees only families
 * with curated content.
 */
export function listAllToolFamilyExamples(): Record<string, ToolFamilyExample[]> {
  const out: Record<string, ToolFamilyExample[]> = {};
  for (const [category, examples] of FAMILY_EXAMPLES.entries()) {
    out[category] = [...examples];
  }
  return out;
}

/**
 * Returns every distinct tool name referenced by a curated example.
 * Used by tests that want to assert the example table only references
 * tools that the server actually registers.
 */
export function listExampleToolNames(): string[] {
  const names = new Set<string>();
  for (const examples of FAMILY_EXAMPLES.values()) {
    for (const example of examples) {
      names.add(example.tool);
    }
  }
  return [...names].sort();
}
