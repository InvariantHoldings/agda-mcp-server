import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import type { AgdaResponse } from "../../../src/agda/types.js";
import { decodeDisplayTextResponses } from "../../../src/protocol/responses/text-display.js";

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
        }, { requiredKeys: [] }),
        fc.constant(undefined),
      ),
    }, { requiredKeys: [] })),
    (responses) => {
      const decoded = decodeDisplayTextResponses(responses as AgdaResponse[]);
      expect(typeof decoded.text).toBe("string");
      expect(Array.isArray(decoded.messages)).toBeTruthy();
      expect(decoded.messages.every((message) => typeof message === "string")).toBeTruthy();
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
      expect(decoded.messages.every((message) => message.includes("Agda version"))).toBeTruthy();
    },
  ));
});
