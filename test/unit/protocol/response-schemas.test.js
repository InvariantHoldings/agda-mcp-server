import test from "node:test";
import assert from "node:assert/strict";

import {
  allGoalsWarningsInfoSchema,
  displayInfoResponseSchema,
  goalSpecificInfoSchema,
  parseResponseWithSchema,
  solveAllResponseSchema,
  statusResponseSchema,
} from "../../../dist/protocol/response-schemas.js";

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

  assert.equal(parsed.info.kind, "AllGoalsWarnings");
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

  assert.equal(parsed.goalInfo.typeAux?.expr, "Nat");
  assert.equal(parsed.goalInfo.typeAux?.term, "zero");
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

  assert.equal(nested.status?.checked, true);
  assert.equal(flat.checked, false);
});

test("solveAllResponseSchema parses normalized solution objects", () => {
  const parsed = solveAllResponseSchema.parse({
    kind: "SolveAll",
    solutions: [
      { interactionPoint: 1, expression: "refl" },
    ],
  });

  assert.deepEqual(parsed.solutions, [{ interactionPoint: 1, expression: "refl" }]);
});

test("parseResponseWithSchema returns null on schema mismatch", () => {
  const parsed = parseResponseWithSchema(displayInfoResponseSchema, {
    kind: "Status",
    checked: true,
  });

  assert.equal(parsed, null);
});

test("allGoalsWarningsInfoSchema requires normalized array fields", () => {
  const result = allGoalsWarningsInfoSchema.safeParse({
    kind: "AllGoalsWarnings",
    visibleGoals: "?0 : Nat",
    invisibleGoals: [],
    warnings: [],
    errors: [],
  });

  assert.equal(result.success, false);
});
