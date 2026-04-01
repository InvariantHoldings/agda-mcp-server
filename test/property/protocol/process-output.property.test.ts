import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import {
  decodeInteractionPointIds,
  decodeStderrOutputs,
} from "../../../src/protocol/responses/process-output.js";

test("decodeInteractionPointIds is total and returns unique numbers", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }, { withDeletedKeys: true })),
      (responses) => {
        const decoded = decodeInteractionPointIds(responses);
        expect(Array.isArray(decoded)).toBeTruthy();
        expect(decoded.every((value) => typeof value === "number")).toBeTruthy();
        expect(decoded.length).toBe(new Set(decoded).size);
      },
    ),
  );
});

test("decodeStderrOutputs is total and returns strings", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }, { withDeletedKeys: true })),
      (responses) => {
        const decoded = decodeStderrOutputs(responses);
        expect(Array.isArray(decoded)).toBeTruthy();
        expect(decoded.every((value) => typeof value === "string")).toBeTruthy();
      },
    ),
  );
});
