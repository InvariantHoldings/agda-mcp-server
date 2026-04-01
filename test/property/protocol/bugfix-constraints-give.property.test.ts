import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import { decodeGiveLikeResponse } from "../../../src/protocol/responses/proof-actions.js";
import { rewriteTopLevelCommand, topLevelCommand } from "../../../src/protocol/command-builder.js";

// ── Bug 1: Cmd_constraints is a bare command — must NOT include a rewrite arg ──
//
// Original incorrect code sent `Cmd_constraints Normalised` which Agda rejects.
// The fix uses `topLevelCommand("Cmd_constraints")` (no trailing argument).

test("Cmd_constraints IOTCM is bare — no normalization argument (Bug 1)", () => {
  const cmd = topLevelCommand("Cmd_constraints");
  expect(cmd).toBe("Cmd_constraints");
});

test("rewriteTopLevelCommand always appends the rewrite mode (helper correctness)", async () => {
  const modes = ["Normalised", "Instantiated", "HeadNormal", "Simplified", "AsIs"];
  await fc.assert(
    fc.property(
      fc.constantFrom(...modes),
      (mode) => {
        const cmd = rewriteTopLevelCommand("Cmd_metas", mode);
        expect(cmd.startsWith("Cmd_metas ")).toBeTruthy();
        expect(cmd.endsWith(` ${mode}`)).toBeTruthy();
        expect(cmd).not.toBe("Cmd_metas");
      },
    ),
  );
});

// ── Bug 2: GiveResult paren objects must be rendered as text ─────────

test("decodeGiveLikeResponse renders paren objects as human-readable text (Bug 2)", async () => {
  await fc.assert(
    fc.property(fc.boolean(), (paren) => {
      const result = decodeGiveLikeResponse([
        { kind: "GiveAction", giveResult: JSON.stringify({ paren }) },
      ]);
      // Must never contain raw JSON
      expect(!result.includes("{")).toBeTruthy();
      expect(!result.includes("}")).toBeTruthy();
      expect(result).toBe("Term accepted");
    }),
  );
});

test("decodeGiveLikeResponse preserves non-paren string results", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1 }).filter((s) => {
        try {
          const p = JSON.parse(s);
          return !(p && typeof p === "object" && "paren" in p);
        } catch {
          return true;
        }
      }),
      (val) => {
        const result = decodeGiveLikeResponse([
          { kind: "GiveAction", giveResult: val },
        ]);
        expect(result).toBe(val);
      },
    ),
  );
});

test("decodeGiveLikeResponse: paren=true and paren=false both produce same message", () => {
  const trueResult = decodeGiveLikeResponse([
    { kind: "GiveAction", giveResult: '{"paren":true}' },
  ]);
  const falseResult = decodeGiveLikeResponse([
    { kind: "GiveAction", giveResult: '{"paren":false}' },
  ]);
  expect(trueResult).toBe("Term accepted");
  expect(falseResult).toBe("Term accepted");
});

test("decodeGiveLikeResponse: GiveAction with actual expression string is preserved", () => {
  const result = decodeGiveLikeResponse([
    { kind: "GiveAction", giveResult: "refl" },
  ]);
  expect(result).toBe("refl");
});
