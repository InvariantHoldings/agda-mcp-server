import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import { runLoad, runLoadNoMetas } from "../../../src/agda/session-load-impl.js";

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

test("runLoad never reports ok-complete when source contains at least one explicit hole marker", async () => {
  const root = mkdtempSync(join(tmpdir(), "agda-load-property-"));
  const file = "Probe.agda";
  const abs = resolve(root, file);

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
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (holeCount) => {
        const body = Array.from({ length: holeCount }, (_, i) => `x${i} : Set\nx${i} = {!!}`).join("\n\n");
        writeFileSync(abs, `module Probe where\n\n${body}\n`, "utf8");

        const result = await runLoad(session, file);
        expect(result.success).toBe(true);
        expect(result.classification).toBe("ok-with-holes");
        expect(result.hasHoles).toBe(true);
        expect(result.isComplete).toBe(false);
        expect(result.goalCount >= holeCount).toBe(true);
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLoadNoMetas never reports ok-complete when source contains explicit hole markers", async () => {
  const root = mkdtempSync(join(tmpdir(), "agda-load-no-metas-property-"));
  const file = "ProbeStrict.agda";
  const abs = resolve(root, file);

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
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (holeCount) => {
        const body = Array.from({ length: holeCount }, (_, i) => `x${i} : Set\nx${i} = {!!}`).join("\n\n");
        writeFileSync(abs, `module ProbeStrict where\n\n${body}\n`, "utf8");

        const result = await runLoadNoMetas(session, file);
        expect(result.success).toBe(false);
        expect(result.classification).toBe("type-error");
        expect(result.hasHoles).toBe(true);
        expect(result.isComplete).toBe(false);
        expect(result.goalCount >= holeCount).toBe(true);
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
