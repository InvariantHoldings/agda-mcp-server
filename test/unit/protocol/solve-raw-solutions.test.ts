import { describe, test, expect } from "vitest";

import { decodeSolveRawSolutions } from "../../../src/protocol/responses/proof-actions.js";

describe("decodeSolveRawSolutions", () => {
  test("extracts goalId and expr from a SolveAll response", () => {
    const result = decodeSolveRawSolutions([
      {
        kind: "SolveAll",
        solutions: [{ interactionPoint: 3, expression: "refl" }],
      },
    ]);

    expect(result).toEqual([{ goalId: 3, expr: "refl" }]);
  });

  test("handles multiple solutions", () => {
    const result = decodeSolveRawSolutions([
      {
        kind: "SolveAll",
        solutions: [
          { interactionPoint: 0, expression: "refl" },
          { interactionPoint: 1, expression: "suc zero" },
        ],
      },
    ]);

    expect(result).toEqual([
      { goalId: 0, expr: "refl" },
      { goalId: 1, expr: "suc zero" },
    ]);
  });

  test("returns empty array when no SolveAll response present", () => {
    const result = decodeSolveRawSolutions([
      { kind: "DisplayInfo", info: { kind: "Auto", message: "no solutions" } },
    ]);

    expect(result).toEqual([]);
  });

  test("skips solutions with empty expression", () => {
    const result = decodeSolveRawSolutions([
      {
        kind: "SolveAll",
        solutions: [
          { interactionPoint: 0, expression: "" },
          { interactionPoint: 1, expression: "zero" },
        ],
      },
    ]);

    expect(result).toEqual([{ goalId: 1, expr: "zero" }]);
  });

  test("returns empty array for empty responses", () => {
    expect(decodeSolveRawSolutions([])).toEqual([]);
  });

  test("collects solutions from multiple SolveAll responses", () => {
    const result = decodeSolveRawSolutions([
      { kind: "SolveAll", solutions: [{ interactionPoint: 0, expression: "refl" }] },
      { kind: "SolveAll", solutions: [{ interactionPoint: 1, expression: "tt" }] },
    ]);

    expect(result).toEqual([
      { goalId: 0, expr: "refl" },
      { goalId: 1, expr: "tt" },
    ]);
  });
});
