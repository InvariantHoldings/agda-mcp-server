import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import type { AgdaResponse } from "../../../src/agda/types.js";
import { decodeDisplayInfoEvents } from "../../../src/protocol/responses/display-info.js";

test("decodeDisplayInfoEvents is total and only emits string text/kind pairs", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }, { requiredKeys: [] })),
      (responses) => {
        const decoded = decodeDisplayInfoEvents(responses as AgdaResponse[]);
        expect(Array.isArray(decoded)).toBeTruthy();
        for (const event of decoded) {
          expect(event.source === "top-level" || event.source === "goal-specific").toBeTruthy();
          expect(typeof event.infoKind).toBe("string");
          expect(typeof event.text).toBe("string");
          expect(event.payload && typeof event.payload === "object").toBeTruthy();
        }
      },
    ),
  );
});
