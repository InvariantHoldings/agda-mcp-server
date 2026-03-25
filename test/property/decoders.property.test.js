import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { decodeBackendResponses } from "../../dist/protocol/responses/backend.js";
import { decodeProcessControlResponses } from "../../dist/protocol/responses/process-controls.js";
import { decodeGiveLikeResponse, decodeSolveResponses } from "../../dist/protocol/responses/proof-actions.js";

// ── Backend decoder properties ───────────────────────────

test("decodeBackendResponses: totality — never throws", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }), { maxLength: 5 }),
      (responses) => {
        const result = decodeBackendResponses(responses);
        assert.equal(typeof result.output, "string");
        assert.equal(typeof result.success, "boolean");
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
      assert.equal(result.success, false);
      assert.ok(result.output.length > 0);
    }),
  );
});

test("decodeBackendResponses: success defaults to true without errors", async () => {
  const result = decodeBackendResponses([]);
  assert.equal(result.success, true);
});

test("decodeBackendResponses: stderr with 'error' sets success=false", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1 }), (prefix) => {
      const result = decodeBackendResponses([
        { kind: "StderrOutput", text: prefix + " error occurred" },
      ]);
      assert.equal(result.success, false);
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
        assert.ok(Array.isArray(result.messages));
        assert.ok(typeof result.state === "object");
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
          assert.equal(result.state.checked, checked);
        } else {
          assert.equal(result.state.checked, null);
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
        assert.equal(typeof result, "string");
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
      assert.equal(result, val);
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
        assert.ok(Array.isArray(result));
        for (const s of result) {
          assert.equal(typeof s, "string");
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
        assert.equal(result.length, solutions.length);
        for (const s of result) {
          assert.ok(s.includes(":="), `expected "?X := expr" format, got: ${s}`);
        }
      },
    ),
  );
});
