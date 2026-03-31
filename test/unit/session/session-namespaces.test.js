import test from "node:test";
import assert from "node:assert/strict";

import { createSessionNamespaces } from "../../../dist/session/session-namespaces.js";

test("createSessionNamespaces exposes the expected command groups", () => {
  const namespaces = createSessionNamespaces({
    sendCommand: async () => [],
    iotcm: (cmd) => cmd,
    requireFile: () => "Example.agda",
    goalIds: [],
  });

  assert.deepEqual(Object.keys(namespaces).sort(), [
    "backend",
    "display",
    "expr",
    "goal",
    "query",
  ]);

  assert.equal(typeof namespaces.goal.typeContext, "function");
  assert.equal(typeof namespaces.expr.computeTopLevel, "function");
  assert.equal(typeof namespaces.query.searchAbout, "function");
  assert.equal(typeof namespaces.display.toggleImplicitArgs, "function");
  assert.equal(typeof namespaces.backend.compile, "function");
});
