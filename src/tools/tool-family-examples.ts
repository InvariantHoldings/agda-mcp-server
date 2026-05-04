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
//
// IMMUTABILITY: the loaded table is deep-frozen at module init so
// every accessor returns references the caller cannot mutate. A
// previous version returned shallow copies — tests caught the array
// case, but mutating an example object's `summary` or `args` still
// leaked into subsequent calls and into `agda_tools_catalog` output.
// Freezing once at init costs nothing per call and gives both
// runtime (TypeError on assignment in strict mode) and TypeScript
// (`ReadonlyArray<Readonly<…>>`) safety.

import { z } from "zod";

import { loadJsonData } from "../json-data.js";
import type { ToolCategory } from "./manifest.js";

const toolFamilyExampleSchema = z.object({
  // Constrain the tool name to the registered shape so a typo in the
  // JSON file fails fast at module init instead of surfacing as a
  // missing-tool reference downstream.
  tool: z.string().regex(/^agda_[a-z0-9_]+$/u),
  summary: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  note: z.string().optional(),
});

export type ToolFamilyExample = Readonly<z.infer<typeof toolFamilyExampleSchema>>;

const toolFamilyExamplesFileSchema = z.object({
  $comment: z.string().optional(),
  families: z.record(z.string(), z.array(toolFamilyExampleSchema)),
});

const RAW = loadJsonData(
  "./data/tool-family-examples.json",
  toolFamilyExamplesFileSchema,
  import.meta.url,
);

/**
 * Recursively freeze a plain-object/array tree so every reachable
 * property is read-only at runtime. Idempotent — already-frozen
 * subtrees are skipped to avoid traversing twice when the same
 * example object appears in multiple families.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

const FAMILY_EXAMPLES: ReadonlyMap<string, ReadonlyArray<ToolFamilyExample>> =
  new Map(
    Object.entries(RAW.families).map(
      ([category, examples]) =>
        [category, Object.freeze(examples.map(deepFreeze))] as const,
    ),
  );

/**
 * Returns the representative examples declared for a given tool
 * family (manifest category). Returns an empty array for families
 * with no declared examples — callers should treat that as
 * "no curated examples yet" rather than an error.
 *
 * The returned array and its element objects are deep-frozen, so
 * callers cannot accidentally mutate the shared module table. A
 * caller that needs a mutable copy should `structuredClone` the
 * result themselves.
 */
export function getToolFamilyExamples(
  category: ToolCategory,
): ReadonlyArray<ToolFamilyExample> {
  return FAMILY_EXAMPLES.get(category) ?? EMPTY;
}

const EMPTY: ReadonlyArray<ToolFamilyExample> = Object.freeze([]);

/**
 * Returns every declared family → examples mapping. The returned
 * record, its arrays, and every example object are deep-frozen for
 * the same reason `getToolFamilyExamples` is — the same shared table
 * backs both surfaces, so a mutable copy here would defeat the
 * accessor's immutability guarantee.
 */
export function listAllToolFamilyExamples(): Readonly<
  Record<string, ReadonlyArray<ToolFamilyExample>>
> {
  return ALL_EXAMPLES;
}

const ALL_EXAMPLES: Readonly<Record<string, ReadonlyArray<ToolFamilyExample>>> =
  Object.freeze(Object.fromEntries(FAMILY_EXAMPLES.entries()));

/**
 * Returns every distinct tool name referenced by a curated example.
 * Used by tests that want to assert the example table only references
 * tools that the server actually registers. A fresh array per call so
 * test mutation does not affect the cached set.
 */
export function listExampleToolNames(): string[] {
  return [...EXAMPLE_TOOL_NAMES];
}

const EXAMPLE_TOOL_NAMES: ReadonlyArray<string> = Object.freeze(
  [
    ...new Set(
      [...FAMILY_EXAMPLES.values()].flatMap((examples) =>
        examples.map((example) => example.tool),
      ),
    ),
  ].sort(),
);
