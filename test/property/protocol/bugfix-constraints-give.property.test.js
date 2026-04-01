import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { decodeGiveLikeResponse } from "../../../dist/protocol/responses/proof-actions.js";
import { rewriteTopLevelCommand } from "../../../dist/protocol/command-builder.js";

// ── Bug 1: Cmd_constraints must include normalization argument ───────

test("Cmd_constraints IOTCM includes Normalised argument (Bug 1)", () => {
  const cmd = rewriteTopLevelCommand("Cmd_constraints", "Normalised");
  assert.equal(cmd, "Cmd_constraints Normalised");
});

test("rewriteTopLevelCommand always appends the rewrite mode", async () => {
  const modes = ["Normalised", "Instantiated", "HeadNormal", "Simplified", "AsIs"];
  await fc.assert(
    fc.property(
      fc.constantFrom(...modes),
      (mode) => {
        const cmd = rewriteTopLevelCommand("Cmd_constraints", mode);
        assert.ok(cmd.startsWith("Cmd_constraints "));
        assert.ok(cmd.endsWith(` ${mode}`));
        // Must never be bare "Cmd_constraints" (the bug)
        assert.notEqual(cmd, "Cmd_constraints");
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
      assert.ok(!result.includes("{"), `result should not contain raw JSON: ${result}`);
      assert.ok(!result.includes("}"), `result should not contain raw JSON: ${result}`);
      assert.equal(result, "Term accepted");
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
        assert.equal(result, val);
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
  assert.equal(trueResult, "Term accepted");
  assert.equal(falseResult, "Term accepted");
});

test("decodeGiveLikeResponse: GiveAction with actual expression string is preserved", () => {
  const result = decodeGiveLikeResponse([
    { kind: "GiveAction", giveResult: "refl" },
  ]);
  assert.equal(result, "refl");
});
