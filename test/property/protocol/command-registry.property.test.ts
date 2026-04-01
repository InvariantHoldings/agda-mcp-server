import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import { escapeAgdaString } from "../../../src/agda-process.js";
import {
  upstreamAgdaCommands,
  protocolCommandRegistry,
  getImplementedProtocolCommands,
  getMcpExposedCommands,
  getPlannedProtocolCommands,
} from "../../../src/protocol/command-registry.js";

test("escapeAgdaString removes raw newlines and unescaped quotes", async () => {
  await fc.assert(
    fc.property(fc.string(), (input) => {
      const escaped = escapeAgdaString(input);
      expect(!escaped.includes("\n")).toBeTruthy();

      for (let index = 0; index < escaped.length; index += 1) {
        if (escaped[index] === '"') {
          expect(index > 0 && escaped[index - 1] === "\\").toBeTruthy();
        }
      }
    }),
  );
});

test("protocol registry command names are unique and upstream-backed", async () => {
  await fc.assert(
    fc.property(fc.constant(protocolCommandRegistry), (registry) => {
      const names = registry.map((entry) => entry.agdaCommand);
      expect(new Set(names).size).toBe(names.length);

      for (const entry of registry) {
        expect(upstreamAgdaCommands.includes(entry.agdaCommand)).toBeTruthy();
      }
    }),
  );
});

test("implemented and MCP-exposed command lists are subsets of the registry", () => {
  const registrySet = new Set(protocolCommandRegistry.map((entry) => entry.agdaCommand));

  for (const entry of getImplementedProtocolCommands()) {
    expect(registrySet.has(entry.agdaCommand)).toBeTruthy();
    expect(entry.implemented).toBe(true);
  }

  for (const entry of getMcpExposedCommands()) {
    expect(registrySet.has(entry.agdaCommand)).toBeTruthy();
    expect(entry.exposure).toBe("mcp");
    expect(entry.implemented).toBe(true);
  }
});

test("protocol registry has no remaining planned upstream commands", () => {
  expect(getPlannedProtocolCommands()).toEqual([]);
  expect(getImplementedProtocolCommands().length).toBe(upstreamAgdaCommands.length);
});
