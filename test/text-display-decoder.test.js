import test from "node:test";
import assert from "node:assert/strict";

import { decodeDisplayTextResponses } from "../dist/protocol/responses/text-display.js";

test("decodeDisplayTextResponses returns the last message by default", () => {
  const decoded = decodeDisplayTextResponses([
    { kind: "DisplayInfo", info: { kind: "Generic", message: "first" } },
    { kind: "DisplayInfo", info: { kind: "Generic", message: "second" } },
  ]);

  assert.equal(decoded.text, "second");
  assert.deepEqual(decoded.messages, ["first", "second"]);
});

test("decodeDisplayTextResponses can return the first matching message", () => {
  const decoded = decodeDisplayTextResponses([
    { kind: "DisplayInfo", info: { kind: "Generic", message: "first" } },
    { kind: "DisplayInfo", info: { kind: "Generic", message: "second" } },
  ], { position: "first" });

  assert.equal(decoded.text, "first");
});

test("decodeDisplayTextResponses filters by info kind", () => {
  const decoded = decodeDisplayTextResponses([
    { kind: "DisplayInfo", info: { kind: "Version", message: "Agda version 2.7.0.1" } },
    { kind: "DisplayInfo", info: { kind: "Generic", message: "ignored" } },
  ], { infoKinds: ["Version"] });

  assert.equal(decoded.text, "Agda version 2.7.0.1");
  assert.deepEqual(decoded.messages, ["Agda version 2.7.0.1"]);
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

  assert.equal(decoded.text, "helper : Nat");
});
