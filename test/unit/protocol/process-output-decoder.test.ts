import { test, expect } from "vitest";

import {
  decodeInteractionPointIds,
  decodeStderrOutputs,
} from "../../../src/protocol/responses/process-output.js";

test("decodeInteractionPointIds dedupes ids across responses", () => {
  const decoded = decodeInteractionPointIds([
    { kind: "InteractionPoints", interactionPoints: [1, 2] },
    { kind: "InteractionPoints", interactionPoints: [2, 3] },
  ]);

  expect(decoded).toEqual([1, 2, 3]);
});

test("decodeStderrOutputs returns trimmed non-empty stderr lines", () => {
  const decoded = decodeStderrOutputs([
    { kind: "StderrOutput", text: " warning: note \n" },
    { kind: "StderrOutput", text: "   " },
  ]);

  expect(decoded).toEqual(["warning: note"]);
});
