import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import {
  displayInfoResponseSchema,
  giveActionResponseSchema,
  parseResponseWithSchema,
  solveAllResponseSchema,
  statusResponseSchema,
} from "../../../dist/protocol/response-schemas.js";

test("parseResponseWithSchema is total for arbitrary inputs", async () => {
  await fc.assert(
    fc.property(fc.anything(), (value) => {
      const parsed = parseResponseWithSchema(displayInfoResponseSchema, value);
      assert.ok(parsed === null || parsed.kind === "DisplayInfo");
    }),
  );
});

test("giveActionResponseSchema accepts normalized string results", async () => {
  await fc.assert(
    fc.property(fc.string(), fc.string(), (giveResult, result) => {
      const parsed = giveActionResponseSchema.parse({
        kind: "GiveAction",
        giveResult,
        result,
      });

      assert.equal(parsed.giveResult, giveResult);
      assert.equal(parsed.result, result);
    }),
  );
});

test("solveAllResponseSchema accepts normalized solution arrays", async () => {
  await fc.assert(
    fc.property(
      fc.array(
        fc.record({
          interactionPoint: fc.nat({ max: 10_000 }),
          expression: fc.string(),
        }),
        { maxLength: 5 },
      ),
      (solutions) => {
        const parsed = solveAllResponseSchema.parse({
          kind: "SolveAll",
          solutions,
        });

        assert.deepEqual(parsed.solutions ?? [], solutions);
      },
    ),
  );
});

test("statusResponseSchema preserves boolean status fields when present", async () => {
  await fc.assert(
    fc.property(
      fc.option(fc.boolean(), { nil: undefined }),
      fc.option(fc.boolean(), { nil: undefined }),
      fc.option(fc.boolean(), { nil: undefined }),
      (checked, implicit, irrelevant) => {
        const parsed = statusResponseSchema.parse({
          kind: "Status",
          checked,
          showImplicitArguments: implicit,
          showIrrelevantArguments: irrelevant,
        });

        assert.equal(parsed.checked, checked);
        assert.equal(parsed.showImplicitArguments, implicit);
        assert.equal(parsed.showIrrelevantArguments, irrelevant);
      },
    ),
  );
});
