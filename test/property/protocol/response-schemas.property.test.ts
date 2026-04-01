import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import {
  displayInfoResponseSchema,
  giveActionResponseSchema,
  parseResponseWithSchema,
  solveAllResponseSchema,
  statusResponseSchema,
} from "../../../src/protocol/response-schemas.js";

test("parseResponseWithSchema is total for arbitrary inputs", async () => {
  await fc.assert(
    fc.property(fc.anything(), (value) => {
      const parsed = parseResponseWithSchema(displayInfoResponseSchema, value);
      expect(parsed === null || parsed.kind === "DisplayInfo").toBeTruthy();
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

      expect(parsed.giveResult).toBe(giveResult);
      expect(parsed.result).toBe(result);
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

        expect(parsed.solutions ?? []).toEqual(solutions);
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

        expect(parsed.checked).toBe(checked);
        expect(parsed.showImplicitArguments).toBe(implicit);
        expect(parsed.showIrrelevantArguments).toBe(irrelevant);
      },
    ),
  );
});
