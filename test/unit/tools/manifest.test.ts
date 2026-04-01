import { test, expect } from "vitest";

import {
  clearToolManifest,
  getToolManifestEntry,
  listToolManifest,
  registerManifestEntry,
} from "../../../src/tools/manifest.js";
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
  expect(entry).toBeTruthy();
  expect(entry!.inputFields).toEqual(["file", "goalId"]);
  expect(entry!.outputFields).toEqual(["summary", "goalCount"]);
  expect(entry!.protocolCommands).toEqual(["Cmd_demo"]);
});

test("clearToolManifest removes previous entries", () => {
  clearToolManifest();

  registerManifestEntry({
    name: "demo_tool",
    description: "demo",
    category: "reporting",
    outputDataSchema: z.object({ ok: z.boolean() }),
  });

  expect(listToolManifest().length).toBe(1);
  clearToolManifest();
  expect(listToolManifest().length).toBe(0);
});
