import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import { extractProfilingOutput } from "../../../src/agda/parse-load-responses.js";
import type { AgdaResponse } from "../../../src/agda/types.js";

// ── Totality: extractProfilingOutput never throws ────────────────────

test("extractProfilingOutput is total — never throws on arbitrary response arrays", async () => {
  const agdaResponseArb = fc.record(
    {
      kind: fc.constantFrom(
        "InteractionPoints",
        "DisplayInfo",
        "RunningInfo",
        "Status",
        "StderrOutput",
        "HighlightingInfo",
        "GiveAction",
        "MakeCase",
      ),
      info: fc
        .record(
          {
            kind: fc.constantFrom(
              "AllGoalsWarnings",
              "Time",
              "Error",
              "Version",
              "CompilationOk",
            ),
            message: fc.string(),
            cpuTime: fc.oneof(fc.float(), fc.constant(undefined)),
            visibleGoals: fc.constant([]),
            invisibleGoals: fc.constant([]),
            errors: fc.constant([]),
            warnings: fc.constant([]),
          },
          { requiredKeys: ["kind"] },
        )
        .map((info) => info as Record<string, unknown>),
      message: fc.string(),
      text: fc.string(),
      interactionPoints: fc.array(fc.nat()),
    },
    { requiredKeys: ["kind"] },
  );

  await fc.assert(
    fc.property(
      fc.array(agdaResponseArb, { maxLength: 20 }),
      (responses) => {
        const result = extractProfilingOutput(responses as AgdaResponse[]);
        // Result is either null or a non-empty string
        expect(result === null || (typeof result === "string" && result.length > 0)).toBe(true);
      },
    ),
  );
});

// ── Output invariant: result is null or non-empty string ─────────────

test("result is always null or a non-empty string", async () => {
  const runningInfoArb: fc.Arbitrary<AgdaResponse> = fc.record({
    kind: fc.constant("RunningInfo") as fc.Arbitrary<string>,
    message: fc.string(),
  });

  const timeDisplayInfoArb: fc.Arbitrary<AgdaResponse> = fc.record({
    kind: fc.constant("DisplayInfo") as fc.Arbitrary<string>,
    info: fc.record({
      kind: fc.constant("Time"),
      message: fc.string(),
    }),
  });

  const otherResponseArb: fc.Arbitrary<AgdaResponse> = fc.record({
    kind: fc.constantFrom("InteractionPoints", "Status", "StderrOutput") as fc.Arbitrary<string>,
  });

  await fc.assert(
    fc.property(
      fc.array(fc.oneof(runningInfoArb, timeDisplayInfoArb, otherResponseArb), {
        maxLength: 15,
      }),
      (responses) => {
        const result = extractProfilingOutput(responses);
        if (result !== null) {
          expect(typeof result).toBe("string");
          expect(result.length).toBeGreaterThan(0);
        }
      },
    ),
  );
});

// ── RunningInfo messages are always included in output ────────────────

test("non-empty RunningInfo messages always appear in profiling output", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      (msg) => {
        const responses: AgdaResponse[] = [
          { kind: "RunningInfo", message: msg },
        ];
        const result = extractProfilingOutput(responses);
        expect(result).toContain(msg);
      },
    ),
  );
});

// ── DisplayInfo Time messages are always included in output ──────────

test("non-empty Time DisplayInfo messages always appear in profiling output", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      (msg) => {
        const responses: AgdaResponse[] = [
          {
            kind: "DisplayInfo",
            info: { kind: "Time", message: msg },
          },
        ];
        const result = extractProfilingOutput(responses);
        expect(result).toContain(msg);
      },
    ),
  );
});
