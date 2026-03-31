import test from "node:test";
import assert from "node:assert/strict";

import { decodeDisplayInfoEvents } from "../../../dist/protocol/responses/display-info.js";

test("decodeDisplayInfoEvents reads HelperFunction.signature payloads", () => {
  const events = decodeDisplayInfoEvents([
    {
      kind: "DisplayInfo",
      info: {
        kind: "GoalSpecific",
        goalInfo: {
          kind: "HelperFunction",
          signature: "add1 : Nat -> Nat",
        },
      },
    },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].infoKind, "HelperFunction");
  assert.equal(events[0].text, "add1 : Nat -> Nat");
});
