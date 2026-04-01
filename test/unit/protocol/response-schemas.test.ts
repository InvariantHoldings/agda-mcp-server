import { test, expect } from "vitest";

import {
  allGoalsWarningsInfoSchema,
  displayInfoResponseSchema,
  goalSpecificInfoSchema,
  parseResponseWithSchema,
  solveAllResponseSchema,
  statusResponseSchema,
} from "../../../src/protocol/response-schemas.js";

test("displayInfoResponseSchema parses normalized AllGoalsWarnings payloads", () => {
  const parsed = displayInfoResponseSchema.parse({
    kind: "DisplayInfo",
    info: {
      kind: "AllGoalsWarnings",
      visibleGoals: ["?0 : Nat"],
      invisibleGoals: [],
      warnings: [],
      errors: [],
    },
  });

  expect(parsed.info.kind).toBe("AllGoalsWarnings");
});

test("goalSpecificInfoSchema parses goal info with typeAux expr/term fields", () => {
  const parsed = goalSpecificInfoSchema.parse({
    kind: "GoalSpecific",
    goalInfo: {
      kind: "GoalType",
      type: "Nat",
      typeAux: {
        expr: "Nat",
        term: "zero",
      },
    },
  });

  expect(parsed.goalInfo.typeAux?.expr).toBe("Nat");
  expect(parsed.goalInfo.typeAux?.term).toBe("zero");
});

test("statusResponseSchema parses both nested and flat status fields", () => {
  const nested = statusResponseSchema.parse({
    kind: "Status",
    status: {
      checked: true,
      showImplicitArguments: false,
      showIrrelevantArguments: true,
    },
  });
  const flat = statusResponseSchema.parse({
    kind: "Status",
    checked: false,
    showImplicitArguments: true,
    showIrrelevantArguments: false,
  });

  expect(nested.status?.checked).toBe(true);
  expect(flat.checked).toBe(false);
});

test("solveAllResponseSchema parses normalized solution objects", () => {
  const parsed = solveAllResponseSchema.parse({
    kind: "SolveAll",
    solutions: [
      { interactionPoint: 1, expression: "refl" },
    ],
  });

  expect(parsed.solutions).toEqual([{ interactionPoint: 1, expression: "refl" }]);
});

test("parseResponseWithSchema returns null on schema mismatch", () => {
  const parsed = parseResponseWithSchema(displayInfoResponseSchema, {
    kind: "Status",
    checked: true,
  });

  expect(parsed).toBe(null);
});

test("allGoalsWarningsInfoSchema requires normalized array fields", () => {
  const result = allGoalsWarningsInfoSchema.safeParse({
    kind: "AllGoalsWarnings",
    visibleGoals: "?0 : Nat",
    invisibleGoals: [],
    warnings: [],
    errors: [],
  });

  expect(result.success).toBe(false);
});
