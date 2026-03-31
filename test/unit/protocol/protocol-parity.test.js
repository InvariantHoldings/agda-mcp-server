import test from "node:test";
import assert from "node:assert/strict";

import {
  getKnownProtocolGaps,
  getProtocolParitySummary,
  listProtocolParityMatrix,
} from "../../../dist/protocol/parity-matrix.js";
import { upstreamAgdaCommands } from "../../../dist/protocol/command-registry.js";

test("protocol parity matrix tracks every upstream command exactly once", () => {
  const entries = listProtocolParityMatrix();
  const names = entries.map((entry) => entry.agdaCommand);

  assert.equal(entries.length, upstreamAgdaCommands.length);
  assert.equal(new Set(names).size, names.length);

  for (const command of upstreamAgdaCommands) {
    assert.ok(names.includes(command), `missing parity entry for ${command}`);
  }
});

test("protocol parity summary counts are internally consistent", () => {
  const summary = getProtocolParitySummary();

  assert.equal(summary.trackedCommandCount, summary.upstreamCommandCount);
  assert.equal(
    summary.endToEndCount + summary.verifiedCount + summary.mappedCount + summary.knownGapCount,
    summary.trackedCommandCount,
  );
});

test("protocol parity matrix records search_about as end-to-end", () => {
  const entries = listProtocolParityMatrix();
  const knownGaps = getKnownProtocolGaps();
  const searchAbout = entries.find((entry) => entry.agdaCommand === "Cmd_search_about_toplevel");

  assert.ok(searchAbout);
  assert.equal(searchAbout.parityStatus, "end-to-end");
  assert.equal(searchAbout.coverageLevel, "mcp");
  assert.ok(searchAbout.issues.includes(7));
  assert.ok(!knownGaps.some((entry) => entry.agdaCommand === "Cmd_search_about_toplevel"));
});

test("protocol parity matrix records expression and context commands as end-to-end", () => {
  const entries = listProtocolParityMatrix();

  for (const agdaCommand of [
    "Cmd_context",
    "Cmd_infer",
    "Cmd_infer_toplevel",
    "Cmd_compute",
    "Cmd_compute_toplevel",
    "Cmd_goal_type_context_infer",
    "Cmd_goal_type_context_check",
  ]) {
    const entry = entries.find((candidate) => candidate.agdaCommand === agdaCommand);
    assert.ok(entry, `missing parity entry for ${agdaCommand}`);
    assert.equal(entry.parityStatus, "end-to-end");
  }
});
