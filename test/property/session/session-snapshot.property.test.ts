// MIT License — see LICENSE
//
// Property-based tests for session snapshot invariants.

import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  deriveSessionSnapshot,
  deriveSuggestedActions,
  type SnapshotInput,
} from "../../../src/session/session-snapshot.js";

// ── Generators ──────────────────────────────────────────────────────

const arbPhase = fc.constantFrom(
  "idle" as const,
  "starting" as const,
  "ready" as const,
  "loaded" as const,
  "busy" as const,
  "exiting" as const,
);

const arbClassification = fc.constantFrom(
  "ok-complete",
  "ok-with-holes",
  "type-error",
  null,
);

const arbGoalIds = fc.array(fc.nat({ max: 100 }), { minLength: 0, maxLength: 10 });

const arbSnapshotInput: fc.Arbitrary<SnapshotInput> = fc.record({
  phase: arbPhase,
  loadedFile: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
  projectRoot: fc.string({ minLength: 1, maxLength: 30 }),
  stale: fc.boolean(),
  goalIds: arbGoalIds,
  invisibleGoalCount: fc.nat({ max: 20 }),
  classification: arbClassification,
  agdaVersion: fc.option(fc.string({ minLength: 3, maxLength: 10 }), { nil: null }),
  lastLoadedAt: fc.option(fc.nat(), { nil: null }),
});

// ── Properties ──────────────────────────────────────────────────────

test("snapshot goalCount always equals goalIds.length", async () => {
  await fc.assert(
    fc.property(arbSnapshotInput, (input) => {
      const snap = deriveSessionSnapshot(input);
      expect(snap.goalCount).toBe(input.goalIds.length);
    }),
  );
});

test("snapshot hasHoles is true iff goalCount > 0 or invisibleGoalCount > 0", async () => {
  await fc.assert(
    fc.property(arbSnapshotInput, (input) => {
      const snap = deriveSessionSnapshot(input);
      const expected = input.goalIds.length > 0 || input.invisibleGoalCount > 0;
      expect(snap.hasHoles).toBe(expected);
    }),
  );
});

test("snapshot isComplete is true only when classification is ok-complete", async () => {
  await fc.assert(
    fc.property(arbSnapshotInput, (input) => {
      const snap = deriveSessionSnapshot(input);
      if (snap.isComplete) {
        expect(snap.classification).toBe("ok-complete");
      }
    }),
  );
});

test("snapshot classification is one of the valid values or null", async () => {
  await fc.assert(
    fc.property(arbSnapshotInput, (input) => {
      const snap = deriveSessionSnapshot(input);
      expect(
        snap.classification === null ||
        snap.classification === "ok-complete" ||
        snap.classification === "ok-with-holes" ||
        snap.classification === "type-error",
      ).toBe(true);
    }),
  );
});

test("snapshot phase matches input phase", async () => {
  await fc.assert(
    fc.property(arbSnapshotInput, (input) => {
      const snap = deriveSessionSnapshot(input);
      expect(snap.phase).toBe(input.phase);
    }),
  );
});

test("snapshot goalIds is a copy, not shared reference", async () => {
  await fc.assert(
    fc.property(arbSnapshotInput, (input) => {
      const snap = deriveSessionSnapshot(input);
      if (input.goalIds.length > 0) {
        input.goalIds[0] = -999;
        expect(snap.goalIds[0]).not.toBe(-999);
      }
    }),
  );
});

test("suggested actions are always sorted by priority", async () => {
  await fc.assert(
    fc.property(arbSnapshotInput, (input) => {
      const snap = deriveSessionSnapshot(input);
      for (let i = 1; i < snap.suggestedActions.length; i++) {
        expect(snap.suggestedActions[i].priority).toBeGreaterThanOrEqual(
          snap.suggestedActions[i - 1].priority,
        );
      }
    }),
  );
});

test("suggested actions all have non-empty tool and rationale", async () => {
  await fc.assert(
    fc.property(arbSnapshotInput, (input) => {
      const snap = deriveSessionSnapshot(input);
      for (const action of snap.suggestedActions) {
        expect(action.tool.length).toBeGreaterThan(0);
        expect(action.rationale.length).toBeGreaterThan(0);
        expect(action.priority).toBeGreaterThanOrEqual(1);
      }
    }),
  );
});

test("idle/ready phases always suggest agda_load", async () => {
  await fc.assert(
    fc.property(
      fc.constantFrom("idle" as const, "ready" as const),
      arbClassification,
      fc.boolean(),
      (phase, classification, stale) => {
        const actions = deriveSuggestedActions({
          phase,
          classification,
          hasHoles: false,
          goalCount: 0,
          stale,
          loadedFile: null,
        });
        expect(actions.some((a) => a.tool === "agda_load")).toBe(true);
      },
    ),
  );
});

test("busy phase never suggests proof-action tools", async () => {
  await fc.assert(
    fc.property(arbClassification, (classification) => {
      const actions = deriveSuggestedActions({
        phase: "busy",
        classification,
        hasHoles: false,
        goalCount: 0,
        stale: false,
        loadedFile: "/x.agda",
      });
      const proofTools = ["agda_goal_type", "agda_case_split", "agda_auto", "agda_give"];
      for (const action of actions) {
        expect(proofTools).not.toContain(action.tool);
      }
    }),
  );
});

test("starting phase always suggests agda_session_snapshot", async () => {
  await fc.assert(
    fc.property(arbClassification, fc.boolean(), (classification, stale) => {
      const actions = deriveSuggestedActions({
        phase: "starting",
        classification,
        hasHoles: false,
        goalCount: 0,
        stale,
        loadedFile: null,
      });
      expect(actions).toHaveLength(1);
      expect(actions[0].tool).toBe("agda_session_snapshot");
    }),
  );
});

test("exiting phase always suggests agda_load", async () => {
  await fc.assert(
    fc.property(arbClassification, fc.boolean(), (classification, stale) => {
      const actions = deriveSuggestedActions({
        phase: "exiting",
        classification,
        hasHoles: false,
        goalCount: 0,
        stale,
        loadedFile: "/x.agda",
      });
      expect(actions).toHaveLength(1);
      expect(actions[0].tool).toBe("agda_load");
    }),
  );
});
