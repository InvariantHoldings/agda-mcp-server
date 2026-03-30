import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeInteractionPointIds,
  decodeStderrOutputs,
} from "../../../dist/protocol/responses/process-output.js";

test("decodeInteractionPointIds dedupes ids across responses", () => {
  const decoded = decodeInteractionPointIds([
    { kind: "InteractionPoints", interactionPoints: [1, 2] },
    { kind: "InteractionPoints", interactionPoints: [2, 3] },
  ]);

  assert.deepEqual(decoded, [1, 2, 3]);
});

test("decodeStderrOutputs returns trimmed non-empty stderr lines", () => {
  const decoded = decodeStderrOutputs([
    { kind: "StderrOutput", text: " warning: note \n" },
    { kind: "StderrOutput", text: "   " },
  ]);

  assert.deepEqual(decoded, ["warning: note"]);
});
