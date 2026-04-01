import { test, expect } from "vitest";

import { createSessionNamespaces } from "../../../src/session/session-namespaces.js";

test("createSessionNamespaces exposes the expected command groups", () => {
  const namespaces = createSessionNamespaces({
    sendCommand: async () => [],
    iotcm: (cmd) => cmd,
    requireFile: () => "Example.agda",
    goalIds: [],
  });

  expect(Object.keys(namespaces).sort()).toEqual([
    "backend",
    "display",
    "expr",
    "goal",
    "query",
  ]);

  expect(typeof namespaces.goal.typeContext).toBe("function");
  expect(typeof namespaces.expr.computeTopLevel).toBe("function");
  expect(typeof namespaces.query.searchAbout).toBe("function");
  expect(typeof namespaces.display.toggleImplicitArgs).toBe("function");
  expect(typeof namespaces.backend.compile).toBe("function");
});
