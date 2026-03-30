import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { decodeDisplayTextResponses } from "../../dist/protocol/responses/text-display.js";

test("decodeDisplayTextResponses is total and always returns string fields", () => {
  fc.assert(fc.property(
    fc.array(fc.record({
      kind: fc.string(),
      info: fc.oneof(
        fc.record({
          kind: fc.string(),
          message: fc.option(fc.string(), { nil: undefined }),
          contents: fc.option(fc.string(), { nil: undefined }),
          text: fc.option(fc.string(), { nil: undefined }),
        }, { withDeletedKeys: true }),
        fc.constant(undefined),
      ),
    }, { withDeletedKeys: true })),
    (responses) => {
      const decoded = decodeDisplayTextResponses(responses);
      assert.equal(typeof decoded.text, "string");
      assert.ok(Array.isArray(decoded.messages));
      assert.ok(decoded.messages.every((message) => typeof message === "string"));
    },
  ));
});

test("decodeDisplayTextResponses only returns matching info kinds when filtered", () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom(
      { kind: "DisplayInfo", info: { kind: "Version", message: "Agda version 2.7.0.1" } },
      { kind: "DisplayInfo", info: { kind: "Generic", message: "generic" } },
      { kind: "DisplayInfo", info: { kind: "Other", contents: "other" } },
      { kind: "RunningInfo", message: "running" },
    )),
    (responses) => {
      const decoded = decodeDisplayTextResponses(responses, { infoKinds: ["Version"] });
      assert.ok(decoded.messages.every((message) => message.includes("Agda version")));
    },
  ));
});
