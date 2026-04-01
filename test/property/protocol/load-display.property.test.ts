import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import type { AgdaResponse } from "../../../src/agda/types.js";
import { decodeLoadDisplayResponses } from "../../../src/protocol/responses/load-display.js";

test("decodeLoadDisplayResponses is total and returns structured arrays", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }, { requiredKeys: [] })),
      (responses) => {
        const decoded = decodeLoadDisplayResponses(responses as AgdaResponse[]);
        expect(typeof decoded.text).toBe("string");
        expect(Array.isArray(decoded.visibleGoals)).toBeTruthy();
        expect(Array.isArray(decoded.warnings)).toBeTruthy();
        expect(Array.isArray(decoded.errors)).toBeTruthy();
        expect(decoded.visibleGoals.every((goal) => typeof goal.goalId === "number")).toBeTruthy();
        expect(decoded.visibleGoals.every((goal) => typeof goal.type === "string")).toBeTruthy();
      },
    ),
  );
});
