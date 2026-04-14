// MIT License — see LICENSE
//
// Property-based tests for manifest/schema consistency.

import { test, expect, beforeEach } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  registerManifestEntry,
  clearToolManifest,
  listToolManifest,
  listToolSchemas,
  getToolSchemaEntry,
  type ToolCategory,
} from "../../../src/tools/manifest.js";

import { z } from "zod";

beforeEach(() => {
  clearToolManifest();
});

const arbCategory: fc.Arbitrary<ToolCategory> = fc.constantFrom(
  "session", "proof", "navigation", "process",
  "highlighting", "backend", "analysis", "reporting",
);

const arbToolName = fc.string({ minLength: 3, maxLength: 20 })
  .filter((s) => /^[a-z_]+$/.test(s));

test("every manifest entry has a corresponding schema entry", async () => {
  await fc.assert(
    fc.property(
      fc.array(
        fc.record({
          name: arbToolName,
          category: arbCategory,
        }),
        { minLength: 1, maxLength: 10 },
      ),
      (tools) => {
        clearToolManifest();
        // Register tools with unique names
        const seen = new Set<string>();
        for (const t of tools) {
          if (seen.has(t.name)) continue;
          seen.add(t.name);
          registerManifestEntry({
            name: t.name,
            description: `Test ${t.name}`,
            category: t.category,
            outputDataSchema: z.object({ text: z.string() }),
          });
        }

        const manifest = listToolManifest();
        const schemas = listToolSchemas();

        expect(manifest.length).toBe(schemas.length);
        for (const entry of manifest) {
          const schemaEntry = getToolSchemaEntry(entry.name);
          expect(schemaEntry).toBeDefined();
          expect(schemaEntry!.name).toBe(entry.name);
          expect(schemaEntry!.category).toBe(entry.category);
        }
      },
    ),
  );
});

test("schema outputFields match schema outputSchema keys", async () => {
  await fc.assert(
    fc.property(
      fc.array(arbToolName, { minLength: 1, maxLength: 5 }),
      (names) => {
        clearToolManifest();
        const seen = new Set<string>();
        for (const name of names) {
          if (seen.has(name)) continue;
          seen.add(name);
          registerManifestEntry({
            name,
            description: "test",
            category: "session",
            outputDataSchema: z.object({ text: z.string(), count: z.number() }),
          });
        }

        for (const entry of listToolManifest()) {
          const schema = getToolSchemaEntry(entry.name);
          expect(schema).toBeDefined();
          // outputFields from manifest should match keys from schema
          for (const field of entry.outputFields) {
            expect(schema!.outputSchema).toHaveProperty(field);
          }
        }
      },
    ),
  );
});

test("listToolSchemas is always sorted by name", async () => {
  await fc.assert(
    fc.property(
      fc.array(arbToolName, { minLength: 1, maxLength: 10 }),
      (names) => {
        clearToolManifest();
        const seen = new Set<string>();
        for (const name of names) {
          if (seen.has(name)) continue;
          seen.add(name);
          registerManifestEntry({
            name,
            description: "test",
            category: "proof",
            outputDataSchema: z.object({ x: z.string() }),
          });
        }

        const schemas = listToolSchemas();
        for (let i = 1; i < schemas.length; i++) {
          expect(schemas[i].name >= schemas[i - 1].name).toBe(true);
        }
      },
    ),
  );
});

test("clearToolManifest clears both manifests and schemas", async () => {
  registerManifestEntry({
    name: "temp",
    description: "temp",
    category: "session",
    outputDataSchema: z.object({ x: z.string() }),
  });
  expect(listToolManifest().length).toBe(1);
  expect(listToolSchemas().length).toBe(1);

  clearToolManifest();
  expect(listToolManifest().length).toBe(0);
  expect(listToolSchemas().length).toBe(0);
});
