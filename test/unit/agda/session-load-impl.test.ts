import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { test, expect } from "vitest";

import { runLoad, runLoadNoMetas } from "../../../src/agda/session-load-impl.js";

function makeTempRepo(): string {
  return mkdtempSync(join(tmpdir(), "agda-load-impl-"));
}

function cleanLoadResponses() {
  return [
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
    { kind: "Status", checked: true },
  ];
}

test("runLoad: explicit {!!} hole in source must not classify as ok-complete when protocol reports no goals", async () => {
  const root = makeTempRepo();
  const file = "Hole.agda";
  writeFileSync(resolve(root, file), "module Hole where\n\nx : Set\nx = {!!}\n", "utf8");

  const session = {
    repoRoot: root,
    currentFile: null,
    goalIds: [],
    lastLoadedMtime: 0,
    lastClassification: null,
    lastLoadedAt: null,
    lastInvisibleGoalCount: 0,
    goal: {
      metas: async () => ({ goals: [] }),
    },
    sendCommand: async () => cleanLoadResponses(),
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    const result = await runLoad(session, file);
    expect(result.success).toBe(true);
    expect(result.hasHoles).toBe(true);
    expect(result.isComplete).toBe(false);
    expect(result.classification).toBe("ok-with-holes");
    expect(result.goalCount >= 1).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoadNoMetas: explicit {!!} hole in source must fail strict load even if protocol reports no goals", async () => {
  const root = makeTempRepo();
  const file = "StrictHole.agda";
  writeFileSync(resolve(root, file), "module StrictHole where\n\nx : Set\nx = {!!}\n", "utf8");

  const session = {
    repoRoot: root,
    currentFile: null,
    goalIds: [],
    lastLoadedMtime: 0,
    lastClassification: null,
    lastLoadedAt: null,
    lastInvisibleGoalCount: 0,
    sendCommand: async () => cleanLoadResponses(),
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    const result = await runLoadNoMetas(session, file);
    expect(result.success).toBe(false);
    expect(result.hasHoles).toBe(true);
    expect(result.isComplete).toBe(false);
    expect(result.classification).toBe("type-error");
    expect(result.errors.length >= 1).toBe(true);
    expect(result.goalCount >= 1).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoad: hole-like text inside string literal does not force hole classification", async () => {
  const root = makeTempRepo();
  const file = "NoRealHole.agda";
  writeFileSync(resolve(root, file), 'module NoRealHole where\n\nmsg = "{!!}"\n', "utf8");

  const session = {
    repoRoot: root,
    currentFile: null,
    goalIds: [],
    lastLoadedMtime: 0,
    lastClassification: null,
    lastLoadedAt: null,
    lastInvisibleGoalCount: 0,
    goal: {
      metas: async () => ({ goals: [] }),
    },
    sendCommand: async () => cleanLoadResponses(),
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    const result = await runLoad(session, file);
    expect(result.success).toBe(true);
    expect(result.hasHoles).toBe(false);
    expect(result.isComplete).toBe(true);
    expect(result.classification).toBe("ok-complete");
    expect(result.goalCount).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
