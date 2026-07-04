// MIT License — see LICENSE
//
// Fail-on-warn guard, registered globally via vitest `setupFiles`.
//
// Production code logs at WARN on non-fatal error branches (a killed
// proc, a timed-out Cmd_metas, a malformed config). Those branches are
// exercised by negative-path tests, and the warnings used to leak to the
// console during a release run — noise that made a green suite look sick.
//
// The answer is NOT to silence the logger: that would also hide a warning
// a future change starts emitting by accident. Instead, this guard turns
// an *unexpected* logger.warn into a test failure. A test that legitimately
// drives a warn path opts in by calling `expectWarning(...)` (which also
// asserts the message), so the warning becomes a checked expectation.

import { afterEach, beforeEach, expect, vi } from "vitest";

import { logger } from "../../src/agda/logger.js";

type WarnSpy = ReturnType<typeof vi.spyOn<typeof logger, "warn">>;

let warnSpy: WarnSpy | null = null;
let acknowledged = false;

beforeEach(() => {
  acknowledged = false;
  warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  const spy = warnSpy;
  warnSpy = null;
  if (!spy) return;
  const calls = spy.mock.calls.slice();
  spy.mockRestore();
  if (calls.length > 0 && !acknowledged) {
    const rendered = calls
      .map((call) => `  • ${String(call[0])}${call[1] !== undefined ? " " + safeJson(call[1]) : ""}`)
      .join("\n");
    throw new Error(
      `Unexpected logger.warn during test (${calls.length}):\n${rendered}\n` +
      "If this warning is expected, wrap the assertion with expectWarning(<substring|regex>).",
    );
  }
});

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Assert that the code under test emitted at least one `logger.warn`
 * (optionally matching `match` against the message), and mark the test's
 * warnings as expected so the fail-on-warn guard passes. Call this in a
 * test that deliberately drives a warn path.
 */
export function expectWarning(match?: string | RegExp): void {
  expect(warnSpy, "expectWarning() called with no active warn guard (setupFiles not loaded?)").not.toBeNull();
  const calls = warnSpy!.mock.calls;
  expect(calls.length, "expectWarning(): expected at least one logger.warn, but none fired").toBeGreaterThan(0);
  if (match !== undefined) {
    const hit = calls.some(([msg]) =>
      typeof msg === "string" && (typeof match === "string" ? msg.includes(match) : match.test(msg)),
    );
    const seen = calls.map((call) => String(call[0])).join(" | ");
    expect(hit, `expectWarning(): no logger.warn matched ${String(match)}; saw: ${seen}`).toBe(true);
  }
  acknowledged = true;
}

/**
 * Escape hatch: acknowledge whatever warnings fired without asserting a
 * specific message. Prefer `expectWarning(match)` — use this only when a
 * test's warn output is genuinely variable.
 */
export function ackWarnings(): void {
  acknowledged = true;
}
