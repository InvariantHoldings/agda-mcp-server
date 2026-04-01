import { test, expect } from "vitest";
import type { AgdaCommandContext } from "../../../src/agda/types.js";

import { createSessionNamespaces } from "../../../src/session/session-namespaces.js";

test("createSessionNamespaces exposes the expected command groups", () => {
  const namespaces = createSessionNamespaces({
    sendCommand: async () => [],
    iotcm: (cmd: string) => cmd,
    requireFile: () => "Example.agda",
    goalIds: [],
  } as unknown as AgdaCommandContext);

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
