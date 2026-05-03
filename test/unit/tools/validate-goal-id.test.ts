// MIT License — see LICENSE
//
// Pin the nextAction recovery hints emitted by validateGoalId. The
// distinction between "no goals exist on this load" and "this ID
// isn't in the current goal table" routes the agent to a different
// next step; keep them apart.

import { test, expect } from "vitest";

import { validateGoalId } from "../../../src/tools/tool-gates.js";
import type { AgdaSession } from "../../../src/agda-process.js";

function fakeSession(opts: {
  loadedFile: string | null;
  goalIds: number[];
}): AgdaSession {
  return {
    getLoadedFile: () => opts.loadedFile,
    getGoalIds: () => [...opts.goalIds],
  } as unknown as AgdaSession;
}

test("returns null on a valid goal ID", () => {
  const session = fakeSession({ loadedFile: "Foo.agda", goalIds: [0, 1, 2] });
  expect(validateGoalId(session, 1, "test")).toBeNull();
});

test("no-loaded-file path emits a load-first nextAction", () => {
  const session = fakeSession({ loadedFile: null, goalIds: [] });
  const result = validateGoalId(session, 0, "test");
  expect(result).not.toBeNull();
  const diag = (result as any).structuredContent.diagnostics[0];
  expect(diag.code).toBe("no-loaded-file");
  expect(diag.nextAction).toMatch(/agda_load/u);
});

test("invalid-goal path with NO open goals points at non-goal tools", () => {
  // Distinct nextAction shape: an empty goal table after a clean load
  // means there are no holes to operate on; the agent should switch
  // to non-goal tools or pick a different file.
  const session = fakeSession({ loadedFile: "Clean.agda", goalIds: [] });
  const result = validateGoalId(session, 0, "test");
  expect(result).not.toBeNull();
  const diag = (result as any).structuredContent.diagnostics[0];
  expect(diag.code).toBe("invalid-goal");
  expect(diag.nextAction).toMatch(/no open goals|agda_session_status/u);
});

test("invalid-goal path with goals open lists them in nextAction", () => {
  const session = fakeSession({ loadedFile: "Holes.agda", goalIds: [0, 1, 5] });
  const result = validateGoalId(session, 9, "test");
  expect(result).not.toBeNull();
  const diag = (result as any).structuredContent.diagnostics[0];
  expect(diag.code).toBe("invalid-goal");
  expect(diag.nextAction).toMatch(/\?0/u);
  expect(diag.nextAction).toMatch(/\?5/u);
  expect(diag.nextAction).toMatch(/agda_load/u);
});
