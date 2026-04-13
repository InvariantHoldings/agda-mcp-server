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

// Arbitrary that generates non-whitespace-only strings (whitespace-only
// strings are correctly treated as empty by the trim-based fallback logic).
const nonBlankString = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

// ── RunningInfo messages are included when profiling is enabled ───────

test("non-empty RunningInfo messages always appear in profiling output when enabled", async () => {
  await fc.assert(
    fc.property(
      nonBlankString,
      (msg) => {
        const responses: AgdaResponse[] = [
          { kind: "RunningInfo", message: msg },
        ];
        const result = extractProfilingOutput(responses, { profilingEnabled: true });
        expect(result).toContain(msg);
      },
    ),
  );
});

// ── RunningInfo messages are ignored when profiling is disabled ──────

test("RunningInfo messages are ignored when profilingEnabled is false", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      (msg) => {
        const responses: AgdaResponse[] = [
          { kind: "RunningInfo", message: msg },
        ];
        const result = extractProfilingOutput(responses, { profilingEnabled: false });
        expect(result).toBeNull();
      },
    ),
  );
});

// ── DisplayInfo Time messages are always included in output ──────────

test("non-empty Time DisplayInfo messages always appear in profiling output", async () => {
  await fc.assert(
    fc.property(
      nonBlankString,
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

// ── DisplayInfo Time is never gated by profilingEnabled ──────────────

test("DisplayInfo Time is always captured regardless of profilingEnabled flag", async () => {
  await fc.assert(
    fc.property(
      nonBlankString,
      fc.boolean(),
      (msg, profilingEnabled) => {
        const responses: AgdaResponse[] = [
          {
            kind: "DisplayInfo",
            info: { kind: "Time", message: msg },
          },
        ];
        const result = extractProfilingOutput(responses, { profilingEnabled });
        expect(result).toContain(msg);
      },
    ),
  );
});

// ── profilingEnabled strictly controls RunningInfo inclusion ──────────

test("profilingEnabled=true includes both RunningInfo and Time; false only Time", async () => {
  // Use uniquely-tagged messages to avoid substring collisions between
  // RunningInfo and Time content (e.g. "X" appearing inside "X Y").
  const taggedPair = nonBlankString.chain((base) =>
    fc.tuple(
      fc.constant(`[RUNNING] ${base}`),
      fc.constant(`[TIME] ${base}`),
    ),
  );

  await fc.assert(
    fc.property(
      taggedPair,
      ([runningMsg, timeMsg]) => {
        const responses: AgdaResponse[] = [
          { kind: "RunningInfo", message: runningMsg },
          { kind: "DisplayInfo", info: { kind: "Time", message: timeMsg } },
        ];

        // With profiling enabled: both should appear
        const withProfiling = extractProfilingOutput(responses, { profilingEnabled: true });
        expect(withProfiling).toContain(runningMsg);
        expect(withProfiling).toContain(timeMsg);

        // Without profiling: only Time should appear, not RunningInfo
        const withoutProfiling = extractProfilingOutput(responses, { profilingEnabled: false });
        expect(withoutProfiling).not.toContain(runningMsg);
        expect(withoutProfiling).toContain(timeMsg);
      },
    ),
  );
});
