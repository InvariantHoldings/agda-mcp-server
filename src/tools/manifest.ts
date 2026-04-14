// MIT License — see LICENSE
//
// Runtime manifest for MCP tools.

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export type ToolCategory =
  | "session"
  | "proof"
  | "navigation"
  | "process"
  | "highlighting"
  | "backend"
  | "analysis"
  | "reporting";

export interface ToolManifestEntry {
  name: string;
  description: string;
  category: ToolCategory;
  protocolCommands: string[];
  inputFields: string[];
  outputFields: string[];
  annotations?: ToolAnnotations;
}

/** Extended manifest entry with schema details for agent discovery. */
export interface ToolSchemaEntry extends ToolManifestEntry {
  /** JSON-serializable description of the output data schema. */
  outputSchema: Record<string, string>;
  /** JSON-serializable description of the input schema. */
  inputSchema: Record<string, string>;
}

const toolManifest = new Map<string, ToolManifestEntry>();
const toolSchemas = new Map<string, { inputSchema: unknown; outputDataSchema: z.ZodTypeAny }>();

function schemaKeys(schema: unknown): string[] {
  if (!schema) {
    return [];
  }

  if (typeof schema === "object" && schema !== null && "shape" in schema) {
    const shape = (schema as { shape?: unknown }).shape;
    if (shape && typeof shape === "object") {
      return Object.keys(shape as Record<string, unknown>);
    }
  }

  if (typeof schema === "object" && schema !== null && !("_def" in schema)) {
    return Object.keys(schema as Record<string, unknown>);
  }

  return [];
}

function dataSchemaKeys(schema: z.ZodTypeAny): string[] {
  if ("shape" in schema && typeof schema.shape === "object") {
    return Object.keys(schema.shape as Record<string, unknown>);
  }

  return [];
}

export function registerManifestEntry(args: {
  name: string;
  description: string;
  category: ToolCategory;
  protocolCommands?: string[];
  inputSchema?: unknown;
  outputDataSchema: z.ZodTypeAny;
  annotations?: ToolAnnotations;
}): void {
  toolManifest.set(args.name, {
    name: args.name,
    description: args.description,
    category: args.category,
    protocolCommands: [...(args.protocolCommands ?? [])],
    inputFields: schemaKeys(args.inputSchema),
    outputFields: dataSchemaKeys(args.outputDataSchema),
    annotations: args.annotations,
  });
  toolSchemas.set(args.name, {
    inputSchema: args.inputSchema,
    outputDataSchema: args.outputDataSchema,
  });
}

export function listToolManifest(): ToolManifestEntry[] {
  return [...toolManifest.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function clearToolManifest(): void {
  toolManifest.clear();
  toolSchemas.clear();
}

export function getToolManifestEntry(
  name: string,
): ToolManifestEntry | undefined {
  return toolManifest.get(name);
}

/**
 * Extract a human-readable type description from a Zod schema shape entry.
 * Returns a simplified string like "string", "number", "boolean", "array",
 * "object", or "string?" for optionals.
 */
function describeZodType(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "unknown";

  const s = schema as Record<string, unknown>;

  // Zod 4 uses _zod.def.type
  const zodDef = (s._zod as any)?.def;
  if (zodDef?.type) {
    const t = zodDef.type as string;

    if (t === "optional" || t === "nullable") {
      const inner = zodDef.innerType;
      if (inner) {
        return describeZodType(inner) + "?";
      }
      return "unknown?";
    }

    if (t === "array") return "array";
    if (t === "string") return "string";
    if (t === "number" || t === "int") return "number";
    if (t === "boolean") return "boolean";
    if (t === "enum") return "enum";
    if (t === "record") return "record";
    if (t === "object") return "object";
    if (t === "union") return "union";

    return t;
  }

  // Fallback: check for shape (plain object schemas)
  if ("shape" in s) return "object";

  return "unknown";
}

/**
 * Extract a simplified field→type map from a Zod schema (or plain object of Zod types).
 */
function describeSchemaFields(schema: unknown): Record<string, string> {
  if (!schema || typeof schema !== "object") return {};

  const s = schema as Record<string, unknown>;

  // Zod object schema with .shape
  if ("shape" in s && typeof s.shape === "object" && s.shape !== null) {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(s.shape as Record<string, unknown>)) {
      result[key] = describeZodType(value);
    }
    return result;
  }

  // Plain object of Zod types (used for inputSchema)
  if (!("_zod" in s)) {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(s)) {
      result[key] = describeZodType(value);
    }
    return result;
  }

  return {};
}

/**
 * Get a schema-enriched manifest entry for a tool.
 * Includes field→type mappings for both input and output schemas.
 */
export function getToolSchemaEntry(name: string): ToolSchemaEntry | undefined {
  const entry = toolManifest.get(name);
  const schemas = toolSchemas.get(name);
  if (!entry || !schemas) return undefined;

  return {
    ...entry,
    inputSchema: describeSchemaFields(schemas.inputSchema),
    outputSchema: describeSchemaFields(schemas.outputDataSchema),
  };
}

/**
 * List all tools with schema details for agent discovery.
 */
export function listToolSchemas(): ToolSchemaEntry[] {
  return [...toolManifest.keys()]
    .sort()
    .map((name) => getToolSchemaEntry(name)!)
    .filter(Boolean);
}
