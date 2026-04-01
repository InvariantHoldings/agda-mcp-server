import { test, expect } from "vitest";

import { decodeDisplayInfoEvents } from "../../../src/protocol/responses/display-info.js";

test("decodeDisplayInfoEvents unwraps GoalSpecific payloads into semantic events", () => {
  const decoded = decodeDisplayInfoEvents([
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

  expect(decoded).toEqual([
    {
      source: "goal-specific",
      infoKind: "HelperFunction",
      text: "helper : Nat",
      payload: {
        kind: "HelperFunction",
        message: "helper : Nat",
      },
    },
  ]);
});

test("decodeDisplayInfoEvents prefers structured fields for expression-like info", () => {
  const decoded = decodeDisplayInfoEvents([
    { kind: "DisplayInfo", info: { kind: "NormalForm", expr: "suc zero" } },
    { kind: "DisplayInfo", info: { kind: "InferredType", type: "Nat" } },
    { kind: "DisplayInfo", info: { kind: "GoalType", type: "Nat → Nat" } },
  ]);

  expect(decoded[0].text).toBe("suc zero");
  expect(decoded[1].text).toBe("Nat");
  expect(decoded[2].text).toBe("Nat → Nat");
});

test("decodeDisplayInfoEvents renders SearchAbout results structurally", () => {
  const decoded = decodeDisplayInfoEvents([
    {
      kind: "DisplayInfo",
      info: {
        kind: "SearchAbout",
        search: "Nat",
        results: [
          { name: "zero", term: "Nat" },
          { name: "suc", term: "Nat → Nat" },
        ],
      },
    },
  ]);

  expect(decoded[0].text).toBe("zero : Nat\nsuc : Nat → Nat");
});
