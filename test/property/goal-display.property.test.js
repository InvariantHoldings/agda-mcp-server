import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { decodeGoalDisplayResponses } from "../../dist/protocol/responses/goal-display.js";

// ── Totality: never throws on any response array ─────────

test("decodeGoalDisplayResponses never throws on arbitrary responses", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }), { maxLength: 5 }),
      (responses) => {
        const result = decodeGoalDisplayResponses(responses);
        assert.equal(typeof result.goalType, "string");
        assert.ok(Array.isArray(result.context));
        assert.equal(typeof result.auxiliary, "string");
      },
    ),
  );
});

// ── Context entries: every entry is "name : binding" ─────

test("context entries always have 'name : binding' format", async () => {
  await fc.assert(
    fc.property(
      fc.array(
        fc.record({
          reifiedName: fc.oneof(fc.string(), fc.constant(undefined)),
          originalName: fc.oneof(fc.string(), fc.constant(undefined)),
          binding: fc.oneof(fc.string(), fc.constant(undefined)),
        }),
        { minLength: 1, maxLength: 5 },
      ),
      (entries) => {
        const result = decodeGoalDisplayResponses([
          {
            kind: "DisplayInfo",
            info: { kind: "Context", context: entries },
          },
        ]);
        for (const entry of result.context) {
          assert.ok(entry.includes(" : "), `expected "name : binding" format, got: ${entry}`);
        }
      },
    ),
  );
});

// ── Empty responses → empty result ───────────────────────

test("empty response array produces empty result", () => {
  const result = decodeGoalDisplayResponses([]);
  assert.equal(result.goalType, "");
  assert.deepEqual(result.context, []);
  assert.equal(result.auxiliary, "");
});

// ── GoalType responses populate goalType ─────────────────

test("GoalType DisplayInfo always populates goalType", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1 }), (typeStr) => {
      const result = decodeGoalDisplayResponses([
        {
          kind: "DisplayInfo",
          info: { kind: "GoalType", message: typeStr },
        },
      ]);
      assert.equal(result.goalType, typeStr);
    }),
  );
});

// ── Non-DisplayInfo responses are ignored ────────────────

test("non-DisplayInfo responses do not affect result", async () => {
  const otherKindArb = fc.constantFrom(
    "Status", "RunningInfo", "StderrOutput", "GiveAction",
    "MakeCase", "SolveAll", "ClearRunningInfo", "InteractionPoints",
  );
  await fc.assert(
    fc.property(otherKindArb, (kind) => {
      const result = decodeGoalDisplayResponses([{ kind }]);
      assert.equal(result.goalType, "");
      assert.deepEqual(result.context, []);
      assert.equal(result.auxiliary, "");
    }),
  );
});
