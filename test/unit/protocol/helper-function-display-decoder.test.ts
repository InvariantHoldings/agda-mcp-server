import { test, expect } from "vitest";

import { decodeDisplayInfoEvents } from "../../../src/protocol/responses/display-info.js";

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

  expect(events.length).toBe(1);
  expect(events[0].infoKind).toBe("HelperFunction");
  expect(events[0].text).toBe("add1 : Nat -> Nat");
});
