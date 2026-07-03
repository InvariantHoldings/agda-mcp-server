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

// Cmd_load responses with neither AllGoalsWarnings, Error, nor
// InteractionPoints — i.e. a stream truncated before the goal state.
function truncatedLoadResponses() {
  return [
    { kind: "Status", checked: false },
    { kind: "RunningInfo", message: "Checking Foo" },
    { kind: "HighlightingInfo", filepath: "/tmp/hl", direct: false },
  ];
}

test("runLoad throws (no fabricated success) when the process ended before the goal state", async () => {
  // The transport waits for Agda's goal-state responses, so a response set
  // lacking them means the process ended mid-load. runLoad must fail
  // loudly rather than report a classification — never a fabricated
  // ok-complete, and never an invented status string.
  const root = makeTempRepo();
  const file = "Truncated.agda";
  writeFileSync(resolve(root, file), "module Truncated where\nx : Set\nx = {!!}\n", "utf8");

  let metasCalls = 0;
  const session = {
    repoRoot: root,
    currentFile: "/some/previous.agda",
    goalIds: [7, 8],
    lastLoadedMtime: 123,
    lastClassification: "ok-complete",
    lastLoadedAt: 999,
    lastInvisibleGoalCount: 2,
    goal: { metas: async () => { metasCalls += 1; return { goals: [] }; } },
    sendCommand: async () => truncatedLoadResponses(),
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    await expect(runLoad(session, file)).rejects.toThrow(/ended before completing the load/i);
    // Never ran metas — the guard fires before reconciliation.
    expect(metasCalls).toBe(0);
    // Prior success state was invalidated up front and not restored.
    expect(session.lastClassification).toBeNull();
    expect(session.goalIds).toEqual([]);
    expect(session.currentFile).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoad invalidates prior success state before a load that throws", async () => {
  const root = makeTempRepo();
  const file = "Throws.agda";
  writeFileSync(resolve(root, file), "module Throws where\n", "utf8");

  const session = {
    repoRoot: root,
    currentFile: "/some/previous.agda",
    goalIds: [1, 2, 3],
    lastLoadedMtime: 42,
    lastClassification: "ok-complete",
    lastLoadedAt: 100,
    lastInvisibleGoalCount: 1,
    goal: { metas: async () => ({ goals: [] }) },
    sendCommand: async () => { throw new Error("sendCommand timed out"); },
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    await expect(runLoad(session, file)).rejects.toThrow(/timed out/);
    // The previous file's clean classification and goals must be gone —
    // no stale success can survive the failed load.
    expect(session.lastClassification).toBeNull();
    expect(session.goalIds).toEqual([]);
    expect(session.currentFile).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoad invalidates prior state and records the attempt on a missing file", async () => {
  const root = makeTempRepo();
  let sent = false;
  const session = {
    repoRoot: root,
    currentFile: "/some/previous.agda",
    goalIds: [1, 2],
    lastLoadedMtime: 42,
    lastClassification: "ok-complete",
    lastLoadedAt: 100,
    lastInvisibleGoalCount: 1,
    goal: { metas: async () => ({ goals: [] }) },
    sendCommand: async () => { sent = true; return cleanLoadResponses(); },
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    const result = await runLoad(session, "DoesNotExist.agda");
    expect(result.success).toBe(false);
    expect(sent).toBe(false);
    // Prior clean state wiped; attempt recorded (no stale success).
    expect(session.currentFile).toBeNull();
    expect(session.goalIds).toEqual([]);
    expect(session.lastClassification).toBe(result.classification);
    expect(session.lastLoadedAt).not.toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoad invalidates prior state and records the attempt on invalid options", async () => {
  const root = makeTempRepo();
  const file = "Opts.agda";
  writeFileSync(resolve(root, file), "module Opts where\n", "utf8");
  const session = {
    repoRoot: root,
    currentFile: "/some/previous.agda",
    goalIds: [5],
    lastLoadedMtime: 7,
    lastClassification: "ok-with-holes",
    lastLoadedAt: 100,
    lastInvisibleGoalCount: 0,
    goal: { metas: async () => ({ goals: [] }) },
    sendCommand: async () => cleanLoadResponses(),
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    const result = await runLoad(session, file, { commandLineOptions: ["--interaction-json"] });
    expect(result.classification).toBe("invalid-command-line-options");
    expect(session.currentFile).toBeNull();
    expect(session.goalIds).toEqual([]);
    expect(session.lastClassification).toBe("invalid-command-line-options");
    expect(session.lastLoadedAt).not.toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoadNoMetas accepts a clean strict load reporting an empty goal state", async () => {
  // The strict load runs over Cmd_load, so a clean file emits the goal-
  // state terminus (empty InteractionPoints + AllGoalsWarnings with no
  // goals). That must report ok-complete.
  const root = makeTempRepo();
  const file = "CleanStrict.agda";
  writeFileSync(resolve(root, file), "module CleanStrict where\n", "utf8");

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
    expect(result.success).toBe(true);
    expect(result.classification).toBe("ok-complete");
    expect(result.hasHoles).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoadNoMetas throws (no false green) when the process ended before the goal state", async () => {
  // Bug #3: a clean Cmd_load_no_metas emits no terminus, so idle
  // completion could resolve a still-checking load as ok-complete. The
  // strict path now runs over Cmd_load and requires the goal-state
  // terminus — a truncated stream must fail loudly, never report success.
  const root = makeTempRepo();
  const file = "TruncatedStrict.agda";
  writeFileSync(resolve(root, file), "module TruncatedStrict where\n", "utf8");

  const session = {
    repoRoot: root,
    currentFile: "/some/previous.agda",
    goalIds: [3],
    lastLoadedMtime: 0,
    lastClassification: "ok-complete",
    lastLoadedAt: null,
    lastInvisibleGoalCount: 0,
    sendCommand: async () => truncatedLoadResponses(),
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    await expect(runLoadNoMetas(session, file)).rejects.toThrow(
      /ended before completing the strict load/i,
    );
    // Prior success state was invalidated up front and not restored.
    expect(session.lastClassification).toBeNull();
    expect(session.goalIds).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

test("runLoad records lastClassification on the process-died-during-reconciliation early-return path", async () => {
  // Regression for Copilot review on PR #56 (round 9 J6 —
  // `session-load-impl.ts:273`): the early return when the metas
  // reconciliation killed the proc bypassed the normal load-state
  // update below. After `session.load()` returned
  // `classification: "process-died-during-reconciliation"`,
  // `session.getLastClassification()` was still whatever the
  // proc-died reset left behind (null) — contradicting AgdaSession's
  // documented contract that the most recent load classification is
  // recorded for every load attempt. Session-status and
  // recommendation tools would lose this failure reason. The fix
  // sets `lastClassification`/`lastLoadedAt` before returning.
  const root = makeTempRepo();
  const file = "Reconcile.agda";
  writeFileSync(resolve(root, file), "module Reconcile where\n", "utf8");

  const session = {
    repoRoot: root,
    currentFile: null as string | null,
    goalIds: [],
    lastLoadedMtime: 0,
    lastClassification: null as string | null,
    lastLoadedAt: null as number | null,
    lastInvisibleGoalCount: 0,
    goal: {
      metas: async () => {
        // Mimic AgdaSession.sendCommand's behavior on a timeout
        // that killed the proc: the `finally` block clears state.
        (session as { currentFile: string | null }).currentFile = null;
        (session as { lastClassification: string | null }).lastClassification = null;
        (session as { lastLoadedAt: number | null }).lastLoadedAt = null;
        throw new Error("sendCommand timed out after 60000ms (received 0 responses: {})");
      },
    },
    sendCommand: async () => cleanLoadResponses(),
    iotcmFor: (_path: string, cmd: string) => cmd,
  } as any;

  try {
    const result = await runLoad(session, file);
    expect(result.success).toBe(false);
    expect(result.classification).toBe("process-died-during-reconciliation");

    // The contract: lastClassification MUST mirror the returned result
    // even on this early-return path. Without the fix it would be null.
    expect(session.lastClassification).toBe("process-died-during-reconciliation");
    expect(session.lastLoadedAt).not.toBeNull();
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
