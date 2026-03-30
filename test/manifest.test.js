import test from "node:test";
import assert from "node:assert/strict";

import {
  clearToolManifest,
  getToolManifestEntry,
  listToolManifest,
  registerManifestEntry,
} from "../dist/tools/manifest.js";
import { z } from "zod";

test("registerManifestEntry captures input and output field names", () => {
  clearToolManifest();

  registerManifestEntry({
    name: "demo_tool",
    description: "demo",
    category: "reporting",
    protocolCommands: ["Cmd_demo"],
    inputSchema: {
      file: z.string(),
      goalId: z.number().optional(),
    },
    outputDataSchema: z.object({
      summary: z.string(),
      goalCount: z.number(),
    }),
  });

  const entry = getToolManifestEntry("demo_tool");
  assert.ok(entry);
  assert.deepEqual(entry.inputFields, ["file", "goalId"]);
  assert.deepEqual(entry.outputFields, ["summary", "goalCount"]);
  assert.deepEqual(entry.protocolCommands, ["Cmd_demo"]);
});

test("clearToolManifest removes previous entries", () => {
  clearToolManifest();

  registerManifestEntry({
    name: "demo_tool",
    description: "demo",
    category: "reporting",
    outputDataSchema: z.object({ ok: z.boolean() }),
  });

  assert.equal(listToolManifest().length, 1);
  clearToolManifest();
  assert.equal(listToolManifest().length, 0);
});
