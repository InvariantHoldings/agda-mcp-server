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

function loadResponsesWithVisibleGoal() {
  return [
    { kind: "InteractionPoints", interactionPoints: [0] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [{ constraintObj: 0, type: "Set" }],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
    { kind: "Status", checked: true },
  ];
}

function loadResponsesWithInvisibleGoal() {
  return [
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        // IOTCM NamedMeta: { name: string, range: Range }
        invisibleGoals: [{ constraintObj: { name: "_1", range: [] }, type: "Set" }],
        errors: [],
        warnings: [],
      },
    },
    { kind: "Status", checked: true },
  ];
}

test("runLoad classifies explicit hole as ok-with-holes despite empty protocol goals", async () => {
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
    // goalCount reflects actual protocol goals (0 here), but hasHoles
    // is true because the source scan found explicit hole markers.
    expect(result.goalCount).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoad reports failure when post-load metas reconciliation killed the proc", async () => {
  // Cmd_load succeeds, but the best-effort `metas()` reconciliation
  // times out and kills the Agda subprocess. `AgdaSession.sendCommand`
  // clears `currentFile` in its finally, then runLoad's catch
  // suppresses the error and would otherwise return a success
  // envelope — leaving the agent thinking the file is loaded while
  // the session is actually empty. The fix detects the cleared
  // `currentFile` and surfaces a process-died-during-reconciliation
  // failure so the agent re-issues agda_load.
  const root = makeTempRepo();
  const file = "Reconcile.agda";
  writeFileSync(resolve(root, file), "module Reconcile where\n", "utf8");
  const absPath = resolve(root, file);

  let metasCalls = 0;
  const session = {
    repoRoot: root,
    currentFile: null as string | null,
    goalIds: [],
    lastLoadedMtime: 0,
    lastClassification: null,
    lastLoadedAt: null,
    lastInvisibleGoalCount: 0,
    goal: {
      // Mimic AgdaSession.sendCommand's behavior on a timeout that
      // killed the proc: the `finally` block clears `currentFile`.
      metas: async () => {
        metasCalls += 1;
        (session as { currentFile: string | null }).currentFile = null;
        throw new Error("sendCommand timed out after 60000ms (received 0 responses: {})");
      },
    },
    sendCommand: async () => cleanLoadResponses(),
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    const result = await runLoad(session, file);
    expect(metasCalls).toBe(1);
    expect(result.success).toBe(false);
    expect(result.classification).toBe("process-died-during-reconciliation");
    expect(result.errors[0]).toMatch(/died during post-load reconciliation/);
    expect(result.errors[0]).toContain(absPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoadNoMetas fails with type-error when explicit holes exist", async () => {
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
    // goalCount matches protocol (0), but hasHoles is true from source scan.
    expect(result.goalCount).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoadNoMetas fails when protocol reports visible goals (unresolved metas)", async () => {
  const root = makeTempRepo();
  const file = "VisibleMeta.agda";
  writeFileSync(resolve(root, file), "module VisibleMeta where\nx : Set\nx = Set\n", "utf8");

  const session = {
    repoRoot: root,
    currentFile: null,
    goalIds: [],
    lastLoadedMtime: 0,
    lastClassification: null,
    lastLoadedAt: null,
    lastInvisibleGoalCount: 0,
    sendCommand: async () => loadResponsesWithVisibleGoal(),
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    const result = await runLoadNoMetas(session, file);
    expect(result.success).toBe(false);
    expect(result.classification).toBe("type-error");
    expect(result.hasHoles).toBe(true);
    expect(result.goalCount).toBeGreaterThan(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoadNoMetas fails when protocol reports invisible goals (unresolved metas)", async () => {
  const root = makeTempRepo();
  const file = "InvisibleMeta.agda";
  writeFileSync(resolve(root, file), "module InvisibleMeta where\nx : Set\nx = Set\n", "utf8");

  const session = {
    repoRoot: root,
    currentFile: null,
    goalIds: [],
    lastLoadedMtime: 0,
    lastClassification: null,
    lastLoadedAt: null,
    lastInvisibleGoalCount: 0,
    sendCommand: async () => loadResponsesWithInvisibleGoal(),
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    const result = await runLoadNoMetas(session, file);
    expect(result.success).toBe(false);
    expect(result.classification).toBe("type-error");
    expect(result.hasHoles).toBe(true);
    expect(result.invisibleGoalCount).toBeGreaterThan(0);
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

test("runLoad passes commandLineOptions into the IOTCM options list", async () => {
  const root = makeTempRepo();
  const file = join(root, "Test.agda");
  writeFileSync(file, "module Test where\n");

  let capturedCmd = "";
  const session = {
    repoRoot: root,
    currentFile: null as string | null,
    goalIds: [] as number[],
    lastLoadedMtime: null,
    lastClassification: null,
    lastLoadedAt: null,
    lastInvisibleGoalCount: 0,
    goal: {
      metas: async () => ({ goals: [] }),
    },
    sendCommand: async (cmd: string) => {
      capturedCmd = cmd;
      return cleanLoadResponses();
    },
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    const result = await runLoad(session, file, { commandLineOptions: ["--Werror", "--safe"] });
    expect(result.success).toBe(true);
    // The command string should contain both flags in the options list
    expect(capturedCmd).toContain('"--Werror"');
    expect(capturedCmd).toContain('"--safe"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoad rejects invalid commandLineOptions", async () => {
  const root = makeTempRepo();
  const file = join(root, "Test.agda");
  writeFileSync(file, "module Test where\n");

  const session = {
    repoRoot: root,
    currentFile: null as string | null,
    goalIds: [] as number[],
    sendCommand: async () => cleanLoadResponses(),
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    const result = await runLoad(session, file, { commandLineOptions: ["--interaction-json"] });
    expect(result.success).toBe(false);
    expect(result.classification).toBe("invalid-command-line-options");
    expect(result.errors[0]).toContain("conflicts with the MCP server");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
