import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { normalizeAgdaResponse } from "../../../dist/agda/normalize-response.js";

// ── Idempotency ───────────────────────────────────────────

test("normalizeAgdaResponse is idempotent for InteractionPoints", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.oneof(fc.integer(), fc.record({ id: fc.integer() }))),
      (points) => {
        const resp = { kind: "InteractionPoints", interactionPoints: points };
        const once = normalizeAgdaResponse(resp);
        const twice = normalizeAgdaResponse(once);
        assert.deepEqual(once, twice);
      },
    ),
  );
});

test("normalizeAgdaResponse is idempotent for AllGoalsWarnings", async () => {
  const fieldArb = fc.oneof(
    fc.constant(""),
    fc.string(),
    fc.array(fc.oneof(fc.string(), fc.record({ type: fc.string() }))),
  );
  await fc.assert(
    fc.property(fieldArb, fieldArb, fieldArb, fieldArb, (vg, ig, err, warn) => {
      const resp = {
        kind: "DisplayInfo",
        info: {
          kind: "AllGoalsWarnings",
          visibleGoals: vg,
          invisibleGoals: ig,
          errors: err,
          warnings: warn,
        },
      };
      const once = normalizeAgdaResponse(resp);
      const twice = normalizeAgdaResponse(once);
      assert.deepEqual(once, twice);
    }),
  );
});

test("normalizeAgdaResponse is idempotent for GiveAction", async () => {
  const valArb = fc.oneof(fc.string(), fc.array(fc.string()), fc.record({ type: fc.string() }));
  await fc.assert(
    fc.property(valArb, (val) => {
      const resp = { kind: "GiveAction", giveResult: val };
      const once = normalizeAgdaResponse(resp);
      const twice = normalizeAgdaResponse(once);
      assert.deepEqual(once, twice);
    }),
  );
});

test("normalizeAgdaResponse is idempotent for SolveAll", async () => {
  const solArb = fc.oneof(
    fc.tuple(fc.integer(), fc.string()),
    fc.record({ interactionPoint: fc.integer(), expression: fc.string() }),
  );
  await fc.assert(
    fc.property(fc.array(solArb), (solutions) => {
      const resp = { kind: "SolveAll", solutions };
      const once = normalizeAgdaResponse(resp);
      const twice = normalizeAgdaResponse(once);
      assert.deepEqual(once, twice);
    }),
  );
});

test("normalizeAgdaResponse is idempotent for Status", async () => {
  await fc.assert(
    fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (c, si, sir) => {
      const resp = {
        kind: "Status",
        status: { checked: c, showImplicitArguments: si, showIrrelevantArguments: sir },
      };
      const once = normalizeAgdaResponse(resp);
      const twice = normalizeAgdaResponse(once);
      assert.deepEqual(once, twice);
    }),
  );
});

// ── Kind preservation ─────────────────────────────────────

test("normalizeAgdaResponse preserves kind for any response", async () => {
  await fc.assert(
    fc.property(
      fc.oneof(
        fc.constant("InteractionPoints"),
        fc.constant("DisplayInfo"),
        fc.constant("GiveAction"),
        fc.constant("MakeCase"),
        fc.constant("RunningInfo"),
        fc.constant("StderrOutput"),
        fc.constant("SolveAll"),
        fc.constant("Status"),
        fc.constant("ClearRunningInfo"),
        fc.string(),
      ),
      (kind) => {
        const resp = normalizeAgdaResponse({ kind });
        assert.equal(resp.kind, kind);
      },
    ),
  );
});

// ── Non-mutation ──────────────────────────────────────────

test("normalizeAgdaResponse never mutates input object", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.oneof(fc.integer(), fc.record({ id: fc.integer() }))),
      (points) => {
        const input = { kind: "InteractionPoints", interactionPoints: points };
        const snapshot = JSON.parse(JSON.stringify(input));
        normalizeAgdaResponse(input);
        assert.deepEqual(input, snapshot);
      },
    ),
  );
});

// ── Type guarantees after normalization ───────────────────

test("InteractionPoints.interactionPoints is always number[] after normalization", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.oneof(fc.integer(), fc.record({ id: fc.integer() }))),
      (points) => {
        const resp = normalizeAgdaResponse({ kind: "InteractionPoints", interactionPoints: points });
        assert.ok(Array.isArray(resp.interactionPoints));
        for (const pt of resp.interactionPoints) {
          assert.equal(typeof pt, "number");
        }
      },
    ),
  );
});

test("AllGoalsWarnings fields are always arrays after normalization", async () => {
  const fieldArb = fc.oneof(
    fc.constant(""),
    fc.constant(undefined),
    fc.string(),
    fc.array(fc.string()),
    fc.array(fc.record({ type: fc.string() })),
  );
  await fc.assert(
    fc.property(fieldArb, fieldArb, fieldArb, fieldArb, (vg, ig, err, warn) => {
      const resp = normalizeAgdaResponse({
        kind: "DisplayInfo",
        info: {
          kind: "AllGoalsWarnings",
          visibleGoals: vg,
          invisibleGoals: ig,
          errors: err,
          warnings: warn,
        },
      });
      const info = resp.info;
      assert.ok(Array.isArray(info.visibleGoals));
      assert.ok(Array.isArray(info.invisibleGoals));
      assert.ok(Array.isArray(info.errors));
      assert.ok(Array.isArray(info.warnings));
    }),
  );
});

test("GiveAction.giveResult is always string after normalization", async () => {
  const valArb = fc.oneof(
    fc.string(),
    fc.array(fc.string()),
    fc.record({ type: fc.string() }),
    fc.record({ str: fc.string() }),
  );
  await fc.assert(
    fc.property(valArb, (val) => {
      const resp = normalizeAgdaResponse({ kind: "GiveAction", giveResult: val });
      assert.equal(typeof resp.giveResult, "string");
    }),
  );
});

test("MakeCase.clauses is always string[] after normalization", async () => {
  const clauseArb = fc.oneof(fc.string(), fc.record({ type: fc.string() }));
  await fc.assert(
    fc.property(fc.array(clauseArb), (clauses) => {
      const resp = normalizeAgdaResponse({ kind: "MakeCase", clauses });
      assert.ok(Array.isArray(resp.clauses));
      for (const c of resp.clauses) {
        assert.equal(typeof c, "string");
      }
    }),
  );
});

test("RunningInfo.message is always string after normalization", async () => {
  const msgArb = fc.oneof(fc.string(), fc.array(fc.string()));
  await fc.assert(
    fc.property(msgArb, (msg) => {
      const resp = normalizeAgdaResponse({ kind: "RunningInfo", message: msg });
      assert.equal(typeof resp.message, "string");
    }),
  );
});

test("SolveAll.solutions are always object form after normalization", async () => {
  const solArb = fc.oneof(
    fc.tuple(fc.integer(), fc.string()),
    fc.record({ interactionPoint: fc.integer(), expression: fc.string() }),
  );
  await fc.assert(
    fc.property(fc.array(solArb), (solutions) => {
      const resp = normalizeAgdaResponse({ kind: "SolveAll", solutions });
      for (const sol of resp.solutions) {
        assert.ok(!Array.isArray(sol), "tuple form should be converted to object");
        assert.ok(typeof sol === "object" && sol !== null);
      }
    }),
  );
});

test("Status boolean fields at top level after normalization", async () => {
  await fc.assert(
    fc.property(fc.boolean(), fc.boolean(), (c, si) => {
      const resp = normalizeAgdaResponse({
        kind: "Status",
        status: { checked: c, showImplicitArguments: si },
      });
      assert.equal(resp.checked, c);
      assert.equal(resp.showImplicitArguments, si);
    }),
  );
});
