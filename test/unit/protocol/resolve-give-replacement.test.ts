import { afterEach, describe, test, expect } from "vitest";

import {
  hasReplacementText,
  resolveGiveReplacementText,
} from "../../../src/protocol/responses/proof-actions.js";

describe("hasReplacementText", () => {
  test("rejects null", () => {
    expect(hasReplacementText(null)).toBe(false);
  });

  test("rejects undefined", () => {
    expect(hasReplacementText(undefined)).toBe(false);
  });

  test("rejects empty string", () => {
    expect(hasReplacementText("")).toBe(false);
  });

  test("accepts non-empty string", () => {
    expect(hasReplacementText("refl")).toBe(true);
  });

  test("accepts whitespace-only string", () => {
    // Intentional: Agda could return whitespace as a valid (if weird)
    // replacement, and rejecting it would be overreach. If this ever
    // becomes a problem the caller can tighten the guard.
    expect(hasReplacementText(" ")).toBe(true);
  });
});

describe("resolveGiveReplacementText", () => {
  test("Give_NoParen returns input expression as-is", () => {
    const responses = [
      { kind: "GiveAction", giveResult: '{"paren":false}' },
    ];
    expect(resolveGiveReplacementText(responses, "refl")).toBe("refl");
  });

  test("Give_Paren wraps input expression in parentheses", () => {
    const responses = [
      { kind: "GiveAction", giveResult: '{"paren":true}' },
    ];
    expect(resolveGiveReplacementText(responses, "suc zero")).toBe("(suc zero)");
  });

  test("Give_String returns the replacement string directly", () => {
    const responses = [
      { kind: "GiveAction", giveResult: "λ x → x" },
    ];
    expect(resolveGiveReplacementText(responses, "some-input")).toBe("λ x → x");
  });

  test("returns null when no GiveAction in responses", () => {
    const responses = [
      { kind: "DisplayInfo", info: { kind: "AllGoalsWarnings" } },
      { kind: "Status", checked: true },
    ];
    expect(resolveGiveReplacementText(responses, "refl")).toBeNull();
  });

  test("falls back to input expression when giveResult is empty", () => {
    const responses = [
      { kind: "GiveAction", giveResult: "" },
    ];
    expect(resolveGiveReplacementText(responses, "zero")).toBe("zero");
  });

  test("handles response with result field instead of giveResult", () => {
    const responses = [
      { kind: "GiveAction", result: '{"paren":false}' },
    ];
    expect(resolveGiveReplacementText(responses, "refl")).toBe("refl");
  });

  describe("prototype pollution safety", () => {
    // Object.hasOwn is used in the "paren" check instead of the `in`
    // operator. These tests verify the distinction matters: a
    // polluted Object.prototype.paren must NOT be mistaken for a
    // legitimate GiveResult envelope.

    const pollutionKey = "paren";

    afterEach(() => {
      // Always clean up, even if an assertion failed.
      delete (Object.prototype as Record<string, unknown>)[pollutionKey];
    });

    test("Give_String containing a plain object without 'paren' is returned verbatim, even under Object.prototype.paren pollution", () => {
      (Object.prototype as Record<string, unknown>)[pollutionKey] = true;

      // `{}` — a legal JSON-parse result that does NOT own `paren`.
      // With the old `"paren" in parsed` check, this would match the
      // polluted prototype and be interpreted as `Give_NoParen`,
      // discarding the actual string payload.
      const responses = [
        { kind: "GiveAction", giveResult: "{}" },
      ];
      const result = resolveGiveReplacementText(responses, "inputExpr");
      // Under the hasOwnKey guard, `{}` does not own `paren`, so we
      // fall through to the Give_String branch and return the
      // original string verbatim.
      expect(result).toBe("{}");
    });

    test("Give_Paren/Give_NoParen still work when prototype is polluted", () => {
      (Object.prototype as Record<string, unknown>)[pollutionKey] = "not-a-real-value";

      // Genuine `{"paren":false}` owns the key, so hasOwnKey returns
      // true and the normal path runs.
      expect(
        resolveGiveReplacementText([{ kind: "GiveAction", giveResult: '{"paren":false}' }], "refl"),
      ).toBe("refl");
      expect(
        resolveGiveReplacementText([{ kind: "GiveAction", giveResult: '{"paren":true}' }], "suc zero"),
      ).toBe("(suc zero)");
    });
  });
});
