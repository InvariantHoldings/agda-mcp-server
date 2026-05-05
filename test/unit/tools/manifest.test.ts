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

test("registerManifestEntry defaults requiresLoadedSession to true", () => {
  clearToolManifest();
  registerManifestEntry({
    name: "demo_tool",
    description: "demo",
    category: "proof",
    outputDataSchema: z.object({ ok: z.boolean() }),
  });

  const entry = getToolManifestEntry("demo_tool");
  expect(entry?.requiresLoadedSession).toBe(true);
});

test("registerManifestEntry honors explicit requiresLoadedSession=false", () => {
  clearToolManifest();
  registerManifestEntry({
    name: "demo_tool",
    description: "demo",
    category: "session",
    requiresLoadedSession: false,
    outputDataSchema: z.object({ ok: z.boolean() }),
  });

  const entry = getToolManifestEntry("demo_tool");
  expect(entry?.requiresLoadedSession).toBe(false);
});

test("registerManifestEntry refuses duplicate names", () => {
  clearToolManifest();
  registerManifestEntry({
    name: "demo_tool",
    description: "first",
    category: "session",
    outputDataSchema: z.object({ ok: z.boolean() }),
  });

  expect(() =>
    registerManifestEntry({
      name: "demo_tool",
      description: "second",
      category: "proof",
      outputDataSchema: z.object({ count: z.number() }),
    }),
  ).toThrow(/Duplicate tool registration for demo_tool/u);

  // The first registration must remain authoritative — the second
  // registration's metadata is rejected entirely.
  const entry = getToolManifestEntry("demo_tool");
  expect(entry?.description).toBe("first");
  expect(entry?.category).toBe("session");
});
