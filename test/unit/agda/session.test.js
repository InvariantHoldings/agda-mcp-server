import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AgdaSession, findAgdaBinary } from "../../../dist/agda-process.js";

test("findAgdaBinary returns pinned script when present", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-server-"));

  try {
    mkdirSync(join(repoRoot, "tooling", "scripts"), { recursive: true });
    const pinned = join(repoRoot, "tooling", "scripts", "run-pinned-agda.sh");
    writeFileSync(pinned, "#!/bin/sh\nexit 0\n", "utf8");
    assert.equal(findAgdaBinary(repoRoot), pinned);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("findAgdaBinary falls back to agda when no pinned script exists", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-server-"));

  try {
    assert.equal(findAgdaBinary(repoRoot), "agda");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("AgdaSession destroy resets mutable session state", () => {
  const session = new AgdaSession(process.cwd());

  session.currentFile = "/tmp/Example.agda";
  session.goalIds = [1, 2, 3];
  session.buffer = "pending";
  session.responseQueue = [{ kind: "Status" }];

  session.destroy();

  assert.equal(session.getLoadedFile(), null);
  assert.deepEqual(session.getGoalIds(), []);
  assert.equal(session.buffer, "");
  assert.deepEqual(session.responseQueue, []);
});

test("AgdaSession syncGoalIdsFromResponses applies explicit goal-state updates", () => {
  const session = new AgdaSession(process.cwd());

  session.goalIds = [1, 2, 3];
  session.syncGoalIdsFromResponses([
    { kind: "InteractionPoints", interactionPoints: [4, 5] },
  ]);

  assert.deepEqual(session.getGoalIds(), [4, 5]);
});

test("AgdaSession forwards legacy backend compatibility methods", async () => {
  const session = new AgdaSession(process.cwd());
  const calls = [];

  session.backend = {
    compile: async (backendExpr, filePath, argv) => {
      calls.push(["compile", backendExpr, filePath, argv]);
      return { kind: "compile" };
    },
    top: async (backendExpr, payload) => {
      calls.push(["top", backendExpr, payload]);
      return { kind: "top" };
    },
    hole: async (goalId, holeContents, backendExpr, payload) => {
      calls.push(["hole", goalId, holeContents, backendExpr, payload]);
      return { kind: "hole" };
    },
  };

  assert.deepEqual(await session.compile("GHC", "/tmp/Test.agda", ["--flag"]), { kind: "compile" });
  assert.deepEqual(await session.backendTop("GHC", "ping"), { kind: "top" });
  assert.deepEqual(await session.backendHole(7, "", "GHC", "pong"), { kind: "hole" });
  assert.deepEqual(calls, [
    ["compile", "GHC", "/tmp/Test.agda", ["--flag"]],
    ["top", "GHC", "ping"],
    ["hole", 7, "", "GHC", "pong"],
  ]);
});
