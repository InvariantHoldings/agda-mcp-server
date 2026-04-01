import { test, expect } from "vitest";

import { decodeDisplayTextResponses } from "../../../src/protocol/responses/text-display.js";

test("decodeDisplayTextResponses returns the last message by default", () => {
  const decoded = decodeDisplayTextResponses([
    { kind: "DisplayInfo", info: { kind: "Generic", message: "first" } },
    { kind: "DisplayInfo", info: { kind: "Generic", message: "second" } },
  ]);

  expect(decoded.text).toBe("second");
  expect(decoded.messages).toEqual(["first", "second"]);
});

test("decodeDisplayTextResponses can return the first matching message", () => {
  const decoded = decodeDisplayTextResponses([
    { kind: "DisplayInfo", info: { kind: "Generic", message: "first" } },
    { kind: "DisplayInfo", info: { kind: "Generic", message: "second" } },
  ], { position: "first" });

  expect(decoded.text).toBe("first");
});

test("decodeDisplayTextResponses filters by info kind", () => {
  const decoded = decodeDisplayTextResponses([
    { kind: "DisplayInfo", info: { kind: "Version", message: "Agda version 2.7.0.1" } },
    { kind: "DisplayInfo", info: { kind: "Generic", message: "ignored" } },
  ], { infoKinds: ["Version"] });

  expect(decoded.text).toBe("Agda version 2.7.0.1");
  expect(decoded.messages).toEqual(["Agda version 2.7.0.1"]);
});

test("decodeDisplayTextResponses unwraps GoalSpecific payloads", () => {
  const decoded = decodeDisplayTextResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "GoalSpecific",
        goalInfo: {
          kind: "HelperFunction",
          message: "helper : Nat",
        },
      },
    },
  ]);

  expect(decoded.text).toBe("helper : Nat");
});
