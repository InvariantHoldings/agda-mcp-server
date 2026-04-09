import { describe, test, expect } from "vitest";

import { resolveGiveReplacementText } from "../../../src/protocol/responses/proof-actions.js";

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
});
