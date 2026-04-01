import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import { decodeBackendResponses } from "../../../src/protocol/responses/backend.js";
import { decodeProcessControlResponses } from "../../../src/protocol/responses/process-controls.js";
import { decodeGiveLikeResponse, decodeSolveResponses } from "../../../src/protocol/responses/proof-actions.js";

// ── Backend decoder properties ───────────────────────────

test("decodeBackendResponses: totality — never throws", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }), { maxLength: 5 }),
      (responses) => {
        const result = decodeBackendResponses(responses);
        expect(typeof result.output).toBe("string");
        expect(typeof result.success).toBe("boolean");
      },
    ),
  );
});

test("decodeBackendResponses: Error DisplayInfo always sets success=false", async () => {
  // Use non-whitespace strings since extractMessage output is trimmed
  const nonEmptyArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);
  await fc.assert(
    fc.property(nonEmptyArb, (msg) => {
      const result = decodeBackendResponses([
        { kind: "DisplayInfo", info: { kind: "Error", message: msg } },
      ]);
      expect(result.success).toBe(false);
      expect(result.output.length > 0).toBeTruthy();
    }),
  );
});

test("decodeBackendResponses: success defaults to true without errors", () => {
  const result = decodeBackendResponses([]);
  expect(result.success).toBe(true);
});

test("decodeBackendResponses: stderr with 'error' sets success=false", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1 }), (prefix) => {
      const result = decodeBackendResponses([
        { kind: "StderrOutput", text: prefix + " error occurred" },
      ]);
      expect(result.success).toBe(false);
    }),
  );
});

// ── Process control decoder properties ───────────────────

test("decodeProcessControlResponses: totality — never throws", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }), { maxLength: 5 }),
      (responses) => {
        const result = decodeProcessControlResponses(responses);
        expect(Array.isArray(result.messages)).toBeTruthy();
        expect(typeof result.state === "object").toBeTruthy();
      },
    ),
  );
});

test("decodeProcessControlResponses: Status booleans are nullable", async () => {
  await fc.assert(
    fc.property(
      fc.oneof(fc.boolean(), fc.constant("not-bool"), fc.constant(null)),
      (checked) => {
        const result = decodeProcessControlResponses([
          { kind: "Status", checked },
        ]);
        if (typeof checked === "boolean") {
          expect(result.state.checked).toBe(checked);
        } else {
          expect(result.state.checked).toBe(null);
        }
      },
    ),
  );
});

// ── Give-like decoder properties ─────────────────────────

test("decodeGiveLikeResponse: totality — never throws", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }), { maxLength: 5 }),
      (responses) => {
        const result = decodeGiveLikeResponse(responses);
        expect(typeof result).toBe("string");
      },
    ),
  );
});

test("decodeGiveLikeResponse: GiveAction result is returned", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1 }), (val) => {
      const result = decodeGiveLikeResponse([
        { kind: "GiveAction", giveResult: val },
      ]);
      expect(result).toBe(val);
    }),
  );
});

// ── Solve decoder properties ─────────────────────────────

test("decodeSolveResponses: totality — never throws", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }), { maxLength: 5 }),
      (responses) => {
        const result = decodeSolveResponses(responses);
        expect(Array.isArray(result)).toBeTruthy();
        for (const s of result) {
          expect(typeof s).toBe("string");
        }
      },
    ),
  );
});

test("decodeSolveResponses: SolveAll with valid solutions → formatted strings", async () => {
  await fc.assert(
    fc.property(
      fc.array(
        fc.record({ interactionPoint: fc.nat({ max: 100 }), expression: fc.string({ minLength: 1 }) }),
        { minLength: 1, maxLength: 5 },
      ),
      (solutions) => {
        const result = decodeSolveResponses([
          { kind: "SolveAll", solutions },
        ]);
        expect(result.length).toBe(solutions.length);
        for (const s of result) {
          expect(s.includes(":=")).toBeTruthy();
        }
      },
    ),
  );
});
