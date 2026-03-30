import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeGiveLikeResponse,
  decodeSolveResponses,
} from "../../../dist/protocol/responses/proof-actions.js";

test("decodeGiveLikeResponse prefers GiveAction payloads", () => {
  const result = decodeGiveLikeResponse([
    { kind: "GiveAction", giveResult: "refl" },
    { kind: "DisplayInfo", info: { kind: "Auto", message: "ignored" } },
  ]);

  assert.equal(result, "refl");
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

  assert.deepEqual(result, ["?3 := refl"]);
});
