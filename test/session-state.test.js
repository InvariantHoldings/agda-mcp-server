import test from "node:test";
import assert from "node:assert/strict";

import { deriveSessionPhase } from "../dist/session/session-state.js";

test("deriveSessionPhase orders lifecycle states correctly", () => {
  assert.equal(
    deriveSessionPhase({ hasProcess: false, hasLoadedFile: false, isCollecting: false, isExiting: false }),
    "idle",
  );

  assert.equal(
    deriveSessionPhase({ hasProcess: true, hasLoadedFile: false, isCollecting: false, isExiting: false }),
    "ready",
  );

  assert.equal(
    deriveSessionPhase({ hasProcess: true, hasLoadedFile: true, isCollecting: false, isExiting: false }),
    "loaded",
  );

  assert.equal(
    deriveSessionPhase({ hasProcess: true, hasLoadedFile: true, isCollecting: true, isExiting: false }),
    "busy",
  );

  assert.equal(
    deriveSessionPhase({ hasProcess: true, hasLoadedFile: true, isCollecting: true, isExiting: true }),
    "exiting",
  );
});
