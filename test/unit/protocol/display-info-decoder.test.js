import test from "node:test";
import assert from "node:assert/strict";

import { decodeDisplayInfoEvents } from "../../../dist/protocol/responses/display-info.js";

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

  assert.deepEqual(decoded, [
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

  assert.equal(decoded[0].text, "suc zero");
  assert.equal(decoded[1].text, "Nat");
  assert.equal(decoded[2].text, "Nat → Nat");
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

  assert.equal(decoded[0].text, "zero : Nat\nsuc : Nat → Nat");
});
