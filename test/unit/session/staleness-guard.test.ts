import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  applyEditAndReload,
  applyBatchEditAndReload,
} from "../../../src/session/reload-and-diagnose.js";
import type { AgdaSession } from "../../../src/agda-process.js";

// Minimal stub session that exercises the staleness guard without
// spawning a real Agda process. We implement the exact surface used
// by applyEditAndReload / applyBatchEditAndReload.
//
// `loadBehavior` lets the test pick between a stub load that throws
// (to prove load() was never called) and one that succeeds with a
// canned LoadResult (to exercise the resync-on-stale path where
// reloadAndDiagnose DOES call load()).
function stubSession(opts: {
  currentFile: string;
  stale: boolean;
  goalIds?: number[];
  loadBehavior?: "throw" | "success";
  postReloadGoalIds?: number[];
}): AgdaSession {
  const goalIds = opts.goalIds ?? [];
  const postReloadGoalIds = opts.postReloadGoalIds ?? goalIds;
  return {
    currentFile: opts.currentFile,
    getGoalIds: () => [...postReloadGoalIds],
    isFileStale: () => opts.stale,
    load: async (_file: string) => {
      if ((opts.loadBehavior ?? "throw") === "throw") {
        throw new Error("load() should not be called in this scenario");
      }
      return {
        success: true,
        errors: [],
        warnings: [],
        goals: [],
        allGoalsText: "",
        invisibleGoalCount: 0,
        goalCount: postReloadGoalIds.length,
        hasHoles: postReloadGoalIds.length > 0,
        isComplete: postReloadGoalIds.length === 0,
        classification: "ok-complete" as const,
      };
    },
  } as unknown as AgdaSession;
}

describe("staleness guard in applyEditAndReload", () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agda-stale-test-"));
    tempFile = join(tempDir, "Test.agda");
    await writeFile(tempFile, "test = {!!}");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("refuses the edit AND resyncs session when stale", async () => {
    // The proof action has already mutated the session by the time
    // applyEditAndReload checks staleness. A stale check that only
    // returned a warning would leave the session in a post-action
    // state while disk is still pre-action. Instead the guard
    // reloads the stale file via session.load() so the session's
    // view matches on-disk truth.
    const session = stubSession({
      currentFile: tempFile,
      stale: true,
      goalIds: [0],
      loadBehavior: "success",
    });

    const output = await applyEditAndReload(session, [0], {
      kind: "replace-hole",
      goalId: 0,
      expr: "refl",
    });

    expect(output).toContain("modified on disk");
    expect(output).toContain("agda_load");
    // Staleness resync: output contains the reload diagnostic,
    // proving load() was actually called on the stale-path.
    expect(output).toContain("Reloaded: 1 goal(s) remaining");
    // File must not have been touched.
    expect(await readFile(tempFile, "utf-8")).toBe("test = {!!}");
  });

  test("refuses the batch edit AND resyncs session when stale", async () => {
    const session = stubSession({
      currentFile: tempFile,
      stale: true,
      goalIds: [0],
      loadBehavior: "success",
    });

    const output = await applyBatchEditAndReload(
      session, [0], tempFile,
      [{ goalId: 0, expr: "refl" }],
    );

    expect(output).toContain("modified on disk");
    expect(output).toContain("agda_load");
    expect(output).toContain("Reloaded: 1 goal(s) remaining");
    expect(await readFile(tempFile, "utf-8")).toBe("test = {!!}");
  });

  test("stale-path reload failure still surfaces a warning", async () => {
    // If the staleness-resync reload itself throws (e.g. Agda
    // process died), reloadAndDiagnose's try/catch must keep the
    // tool response usable.
    const session = stubSession({
      currentFile: tempFile,
      stale: true,
      goalIds: [0],
      loadBehavior: "throw",
    });

    const output = await applyEditAndReload(session, [0], {
      kind: "replace-hole",
      goalId: 0,
      expr: "refl",
    });

    expect(output).toContain("modified on disk");
    expect(output).toContain("Failed to reload");
    expect(await readFile(tempFile, "utf-8")).toBe("test = {!!}");
  });

  test("returns visible warning when session has no loaded file", async () => {
    // Defense-in-depth path: the proof-action tool wrappers already
    // short-circuit on no-file-loaded, but applyEditAndReload should
    // emit a user-visible warning rather than returning "" silently.
    const session = {
      currentFile: null,
      getGoalIds: () => [],
      isFileStale: () => false,
      load: async () => {
        throw new Error("load() should not be called when no file is loaded");
      },
    } as unknown as AgdaSession;

    const output = await applyEditAndReload(session, [], {
      kind: "replace-hole",
      goalId: 0,
      expr: "refl",
    });

    expect(output).toContain("No file is currently loaded");
    expect(output).toContain("agda_load");
    expect(output.length).toBeGreaterThan(0);
  });

  test("does not block when session reports fresh file", async () => {
    // To avoid pulling in a real session, we assert only the negative:
    // when stale=false the guard doesn't short-circuit, so we'd reach
    // applyProofEdit. The stub's load() throws — we catch that through
    // reloadAndDiagnose's own try/catch and expect the warning, which
    // is sufficient to prove the guard did NOT trip first.
    const session = stubSession({
      currentFile: tempFile,
      stale: false,
      goalIds: [0],
    });

    const output = await applyEditAndReload(session, [0], {
      kind: "replace-hole",
      goalId: 0,
      expr: "refl",
    });

    // Edit was applied (guard didn't block), then reloadAndDiagnose
    // tried to call session.load() which threw, and we see the
    // "Failed to reload/resync session" warning from the catch path.
    expect(output).not.toContain("modified on disk");
    expect(output).toContain("Failed to reload");
    // File WAS written, since the guard allowed it.
    expect(await readFile(tempFile, "utf-8")).toBe("test = refl");
  });
});
