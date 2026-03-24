import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { escapeAgdaString } from "../../dist/agda-process.js";
import {
  upstreamAgdaCommands,
  protocolCommandRegistry,
  getImplementedProtocolCommands,
  getMcpExposedCommands,
  getPlannedProtocolCommands,
} from "../../dist/protocol/command-registry.js";

test("escapeAgdaString removes raw newlines and unescaped quotes", async () => {
  await fc.assert(
    fc.property(fc.string(), (input) => {
      const escaped = escapeAgdaString(input);
      assert.ok(!escaped.includes("\n"));

      for (let index = 0; index < escaped.length; index += 1) {
        if (escaped[index] === '"') {
          assert.ok(index > 0 && escaped[index - 1] === "\\");
        }
      }
    }),
  );
});

test("protocol registry command names are unique and upstream-backed", async () => {
  await fc.assert(
    fc.property(fc.constant(protocolCommandRegistry), (registry) => {
      const names = registry.map((entry) => entry.agdaCommand);
      assert.equal(new Set(names).size, names.length);

      for (const entry of registry) {
        assert.ok(upstreamAgdaCommands.includes(entry.agdaCommand));
      }
    }),
  );
});

test("implemented and MCP-exposed command lists are subsets of the registry", () => {
  const registrySet = new Set(protocolCommandRegistry.map((entry) => entry.agdaCommand));

  for (const entry of getImplementedProtocolCommands()) {
    assert.ok(registrySet.has(entry.agdaCommand));
    assert.equal(entry.implemented, true);
  }

  for (const entry of getMcpExposedCommands()) {
    assert.ok(registrySet.has(entry.agdaCommand));
    assert.equal(entry.exposure, "mcp");
    assert.equal(entry.implemented, true);
  }
});

test("protocol registry has no remaining planned upstream commands", () => {
  assert.deepEqual(getPlannedProtocolCommands(), []);
  assert.equal(getImplementedProtocolCommands().length, upstreamAgdaCommands.length);
});
