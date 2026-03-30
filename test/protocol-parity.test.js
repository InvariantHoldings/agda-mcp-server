import test from "node:test";
import assert from "node:assert/strict";

import {
  getKnownProtocolGaps,
  getProtocolParitySummary,
  listProtocolParityMatrix,
} from "../dist/protocol/parity-matrix.js";
import { upstreamAgdaCommands } from "../dist/protocol/command-registry.js";

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
    summary.verifiedCount + summary.mappedCount + summary.knownGapCount,
    summary.trackedCommandCount,
  );
});

test("protocol parity matrix records known search_about gap", () => {
  const knownGaps = getKnownProtocolGaps();
  const searchAbout = knownGaps.find((entry) => entry.agdaCommand === "Cmd_search_about_toplevel");

  assert.ok(searchAbout);
  assert.equal(searchAbout.parityStatus, "known-gap");
  assert.ok(searchAbout.issues.includes(7));
});
