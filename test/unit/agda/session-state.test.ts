import { test, expect } from "vitest";

import { deriveSessionPhase } from "../../../src/session/session-state.js";

test("deriveSessionPhase orders lifecycle states correctly", () => {
  expect(
    deriveSessionPhase({ hasProcess: false, hasLoadedFile: false, isCollecting: false, isExiting: false }),
  ).toBe("idle");

  expect(
    deriveSessionPhase({ hasProcess: true, hasLoadedFile: false, isCollecting: false, isExiting: false }),
  ).toBe("ready");

  expect(
    deriveSessionPhase({ hasProcess: true, hasLoadedFile: true, isCollecting: false, isExiting: false }),
  ).toBe("loaded");

  expect(
    deriveSessionPhase({ hasProcess: true, hasLoadedFile: true, isCollecting: true, isExiting: false }),
  ).toBe("busy");

  expect(
    deriveSessionPhase({ hasProcess: true, hasLoadedFile: true, isCollecting: true, isExiting: true }),
  ).toBe("exiting");
});
