import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AgdaSession, findAgdaBinary } from "../dist/agda-process.js";

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
