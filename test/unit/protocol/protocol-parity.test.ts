import { test, expect } from "vitest";

import {
  getKnownProtocolGaps,
  getProtocolParitySummary,
  listProtocolParityMatrix,
} from "../../../src/protocol/parity-matrix.js";
import { upstreamAgdaCommands } from "../../../src/protocol/command-registry.js";

test("protocol parity matrix tracks every upstream command exactly once", () => {
  const entries = listProtocolParityMatrix();
  const names = entries.map((entry) => entry.agdaCommand);

  expect(entries.length).toBe(upstreamAgdaCommands.length);
  expect(new Set(names).size).toBe(names.length);

  for (const command of upstreamAgdaCommands) {
    expect(names.includes(command), `missing parity entry for ${command}`).toBeTruthy();
  }
});

test("protocol parity summary counts are internally consistent", () => {
  const summary = getProtocolParitySummary();

  expect(summary.trackedCommandCount).toBe(summary.upstreamCommandCount);
  expect(
    summary.endToEndCount + summary.verifiedCount + summary.mappedCount + summary.knownGapCount,
  ).toBe(summary.trackedCommandCount);
});

test("protocol parity matrix records search_about as end-to-end", () => {
  const entries = listProtocolParityMatrix();
  const knownGaps = getKnownProtocolGaps();
  const searchAbout = entries.find((entry) => entry.agdaCommand === "Cmd_search_about_toplevel");

  expect(searchAbout).toBeTruthy();
  expect(searchAbout.parityStatus).toBe("end-to-end");
  expect(searchAbout.coverageLevel).toBe("mcp");
  expect(searchAbout.issues.includes(7)).toBeTruthy();
  expect(!knownGaps.some((entry) => entry.agdaCommand === "Cmd_search_about_toplevel")).toBeTruthy();
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
    expect(entry, `missing parity entry for ${agdaCommand}`).toBeTruthy();
    expect(entry.parityStatus).toBe("end-to-end");
  }
});
