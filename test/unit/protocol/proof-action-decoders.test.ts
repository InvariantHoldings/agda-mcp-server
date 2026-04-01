import { test, expect } from "vitest";

import {
  decodeCaseSplitResponses,
  decodeGiveLikeResponse,
  decodeSolveResponses,
} from "../../../src/protocol/responses/proof-actions.js";

test("decodeGiveLikeResponse prefers GiveAction payloads", () => {
  const result = decodeGiveLikeResponse([
    { kind: "GiveAction", giveResult: "refl" },
    { kind: "DisplayInfo", info: { kind: "Auto", message: "ignored" } },
  ]);

  expect(result).toBe("refl");
});

test("decodeSolveResponses formats SolveAll object payloads", () => {
  const result = decodeSolveResponses([
    {
      kind: "SolveAll",
      solutions: [
        { interactionPoint: 3, expression: "refl" },
      ],
    },
  ]);

  expect(result).toEqual(["?3 := refl"]);
});

test("decodeCaseSplitResponses prefers MakeCase clauses", () => {
  const result = decodeCaseSplitResponses([
    {
      kind: "MakeCase",
      clauses: ["f zero = ?", "f (suc n) = ?"],
    },
  ]);

  expect(result).toEqual(["f zero = ?", "f (suc n) = ?"]);
});
