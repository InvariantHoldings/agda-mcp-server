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

const toolManifest = new Map<string, ToolManifestEntry>();

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
}

export function listToolManifest(): ToolManifestEntry[] {
  return [...toolManifest.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function clearToolManifest(): void {
  toolManifest.clear();
}

export function getToolManifestEntry(
  name: string,
): ToolManifestEntry | undefined {
  return toolManifest.get(name);
}
