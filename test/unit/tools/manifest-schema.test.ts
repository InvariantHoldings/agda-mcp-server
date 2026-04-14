// MIT License — see LICENSE
//
// Unit tests for manifest schema discovery functions.

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";

import {
  registerManifestEntry,
  clearToolManifest,
  getToolSchemaEntry,
  listToolSchemas,
  listToolManifest,
} from "../../../src/tools/manifest.js";

beforeEach(() => {
  clearToolManifest();
});

describe("getToolSchemaEntry", () => {
  it("returns undefined for unknown tool", () => {
    expect(getToolSchemaEntry("nonexistent")).toBeUndefined();
  });

  it("returns schema entry with field types", () => {
    registerManifestEntry({
      name: "test_tool",
      description: "A test",
      category: "session",
      inputSchema: {
        file: z.string(),
        goalId: z.number(),
      },
      outputDataSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        count: z.number(),
      }),
    });

    const entry = getToolSchemaEntry("test_tool");
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("test_tool");
    expect(entry!.outputSchema.success).toBe("boolean");
    expect(entry!.outputSchema.message).toBe("string");
    expect(entry!.outputSchema.count).toBe("number");
  });

  it("handles optional fields", () => {
    registerManifestEntry({
      name: "opt_tool",
      description: "Test optionals",
      category: "navigation",
      inputSchema: {
        required: z.string(),
        optional: z.string().optional(),
      },
      outputDataSchema: z.object({
        text: z.string(),
        extra: z.number().optional(),
      }),
    });

    const entry = getToolSchemaEntry("opt_tool");
    expect(entry).toBeDefined();
    expect(entry!.outputSchema.extra).toContain("?");
  });

  it("handles array and nested fields", () => {
    registerManifestEntry({
      name: "complex_tool",
      description: "Complex schema",
      category: "proof",
      outputDataSchema: z.object({
        items: z.array(z.string()),
        meta: z.object({ key: z.string() }),
      }),
    });

    const entry = getToolSchemaEntry("complex_tool");
    expect(entry).toBeDefined();
    expect(entry!.outputSchema.items).toBe("array");
    expect(entry!.outputSchema.meta).toBe("object");
  });
});

describe("listToolSchemas", () => {
  it("returns empty array when no tools registered", () => {
    expect(listToolSchemas()).toHaveLength(0);
  });

  it("returns sorted schema entries for all tools", () => {
    registerManifestEntry({
      name: "b_tool",
      description: "B",
      category: "session",
      outputDataSchema: z.object({ text: z.string() }),
    });
    registerManifestEntry({
      name: "a_tool",
      description: "A",
      category: "session",
      outputDataSchema: z.object({ count: z.number() }),
    });

    const schemas = listToolSchemas();
    expect(schemas).toHaveLength(2);
    expect(schemas[0].name).toBe("a_tool");
    expect(schemas[1].name).toBe("b_tool");
    expect(schemas[0].outputSchema.count).toBe("number");
    expect(schemas[1].outputSchema.text).toBe("string");
  });
});

describe("manifest consistency", () => {
  it("schema entries have same fields as manifest entries", () => {
    registerManifestEntry({
      name: "consistency_tool",
      description: "Test consistency",
      category: "proof",
      protocolCommands: ["Cmd_test"],
      outputDataSchema: z.object({ result: z.string() }),
    });

    const manifest = listToolManifest();
    const schemas = listToolSchemas();

    expect(manifest).toHaveLength(1);
    expect(schemas).toHaveLength(1);

    expect(manifest[0].name).toBe(schemas[0].name);
    expect(manifest[0].category).toBe(schemas[0].category);
    expect(manifest[0].description).toBe(schemas[0].description);
    expect(manifest[0].outputFields).toContain("result");
    expect(schemas[0].outputSchema).toHaveProperty("result");
  });
});
