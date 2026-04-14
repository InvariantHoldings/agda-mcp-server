// MIT License — see LICENSE
//
// Unit tests for session snapshot domain logic.

import { describe, it, expect } from "vitest";

import {
  deriveSessionSnapshot,
  deriveSuggestedActions,
  type SnapshotInput,
} from "../../../src/session/session-snapshot.js";

function baseInput(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    phase: "loaded",
    loadedFile: "/project/Foo.agda",
    projectRoot: "/project",
    stale: false,
    goalIds: [],
    invisibleGoalCount: 0,
    classification: "ok-complete",
    agdaVersion: "2.6.4.3",
    lastLoadedAt: Date.now(),
    ...overrides,
  };
}

describe("deriveSessionSnapshot", () => {
  it("returns complete snapshot for ok-complete state", () => {
    const snap = deriveSessionSnapshot(baseInput());
    expect(snap.phase).toBe("loaded");
    expect(snap.isComplete).toBe(true);
    expect(snap.hasHoles).toBe(false);
    expect(snap.goalCount).toBe(0);
    expect(snap.classification).toBe("ok-complete");
    expect(snap.stale).toBe(false);
    expect(snap.agdaVersion).toBe("2.6.4.3");
  });

  it("returns ok-with-holes when goals exist", () => {
    const snap = deriveSessionSnapshot(baseInput({
      goalIds: [0, 1, 2],
      classification: "ok-with-holes",
    }));
    expect(snap.isComplete).toBe(false);
    expect(snap.hasHoles).toBe(true);
    expect(snap.goalCount).toBe(3);
    expect(snap.goalIds).toEqual([0, 1, 2]);
    expect(snap.classification).toBe("ok-with-holes");
  });

  it("detects holes from invisible goals alone", () => {
    const snap = deriveSessionSnapshot(baseInput({
      goalIds: [],
      invisibleGoalCount: 2,
      classification: "ok-with-holes",
    }));
    expect(snap.hasHoles).toBe(true);
    expect(snap.goalCount).toBe(0);
    expect(snap.invisibleGoalCount).toBe(2);
  });

  it("handles type-error classification", () => {
    const snap = deriveSessionSnapshot(baseInput({
      classification: "type-error",
    }));
    expect(snap.classification).toBe("type-error");
    expect(snap.isComplete).toBe(false);
  });

  it("handles null classification", () => {
    const snap = deriveSessionSnapshot(baseInput({
      classification: null,
    }));
    expect(snap.classification).toBeNull();
    expect(snap.isComplete).toBe(false);
  });

  it("handles unknown classification string as null", () => {
    const snap = deriveSessionSnapshot(baseInput({
      classification: "process-error",
    }));
    expect(snap.classification).toBeNull();
  });

  it("handles idle phase", () => {
    const snap = deriveSessionSnapshot(baseInput({
      phase: "idle",
      loadedFile: null,
      classification: null,
      lastLoadedAt: null,
    }));
    expect(snap.phase).toBe("idle");
    expect(snap.loadedFile).toBeNull();
    expect(snap.isComplete).toBe(false);
  });

  it("reports stale flag from input", () => {
    const snap = deriveSessionSnapshot(baseInput({ stale: true }));
    expect(snap.stale).toBe(true);
  });

  it("copies goalIds without sharing reference", () => {
    const ids = [0, 1];
    const snap = deriveSessionSnapshot(baseInput({ goalIds: ids }));
    ids.push(2);
    expect(snap.goalIds).toEqual([0, 1]);
  });
});

describe("deriveSuggestedActions", () => {
  it("suggests load for idle phase", () => {
    const actions = deriveSuggestedActions({
      phase: "idle",
      classification: null,
      hasHoles: false,
      goalCount: 0,
      stale: false,
      loadedFile: null,
    });
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions[0].tool).toBe("agda_load");
  });

  it("suggests wait for busy phase", () => {
    const actions = deriveSuggestedActions({
      phase: "busy",
      classification: null,
      hasHoles: false,
      goalCount: 0,
      stale: false,
      loadedFile: "/project/Foo.agda",
    });
    expect(actions.length).toBe(1);
    expect(actions[0].tool).toBe("agda_session_snapshot");
  });

  it("suggests reload for stale file", () => {
    const actions = deriveSuggestedActions({
      phase: "loaded",
      classification: "ok-complete",
      hasHoles: false,
      goalCount: 0,
      stale: true,
      loadedFile: "/project/Foo.agda",
    });
    expect(actions.some((a) => a.tool === "agda_load")).toBe(true);
  });

  it("suggests proof tools for ok-with-holes", () => {
    const actions = deriveSuggestedActions({
      phase: "loaded",
      classification: "ok-with-holes",
      hasHoles: true,
      goalCount: 2,
      stale: false,
      loadedFile: "/project/Foo.agda",
    });
    const tools = actions.map((a) => a.tool);
    expect(tools).toContain("agda_goal_catalog");
    expect(tools).toContain("agda_goal_type");
    expect(tools).toContain("agda_auto");
  });

  it("suggests read_module and load for type-error", () => {
    const actions = deriveSuggestedActions({
      phase: "loaded",
      classification: "type-error",
      hasHoles: false,
      goalCount: 0,
      stale: false,
      loadedFile: "/project/Foo.agda",
    });
    const tools = actions.map((a) => a.tool);
    expect(tools).toContain("agda_read_module");
    expect(tools).toContain("agda_load");
  });

  it("returns actions sorted by priority", () => {
    const actions = deriveSuggestedActions({
      phase: "loaded",
      classification: "ok-with-holes",
      hasHoles: true,
      goalCount: 3,
      stale: false,
      loadedFile: "/project/Foo.agda",
    });
    for (let i = 1; i < actions.length; i++) {
      expect(actions[i].priority).toBeGreaterThanOrEqual(actions[i - 1].priority);
    }
  });
});
