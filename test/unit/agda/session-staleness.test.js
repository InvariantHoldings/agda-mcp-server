import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AgdaSession } from "../../../dist/agda-process.js";

test("isFileStale returns false when no file loaded", () => {
  const session = new AgdaSession(process.cwd());
  assert.equal(session.isFileStale(), false);
  session.destroy();
});

test("isFileStale returns false after destroy", () => {
  const session = new AgdaSession(process.cwd());
  // Simulate loaded state
  session.currentFile = "/tmp/Example.agda";
  session.destroy();
  assert.equal(session.isFileStale(), false);
});

test("isFileStale returns true when file deleted", () => {
  const dir = mkdtempSync(join(tmpdir(), "agda-stale-"));
  const filePath = join(dir, "Test.agda");
  writeFileSync(filePath, "module Test where\n");

  const session = new AgdaSession(dir);
  // Simulate a successful load by setting the state manually
  session.currentFile = filePath;
  // Set lastLoadedMtime via the private field hack — we access it indirectly
  // by calling a simulated load flow. Since we can't call load() without Agda,
  // we test the detection logic directly.

  try {
    // File exists and was just created — not stale yet (no mtime recorded = null)
    // isFileStale with null mtime returns false
    assert.equal(session.isFileStale(), false);

    // Delete the file
    rmSync(filePath);
    // Now isFileStale should return true (stat will throw)
    assert.equal(session.isFileStale(), true);
  } finally {
    session.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
});
