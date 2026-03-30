import test from "node:test";
import assert from "node:assert/strict";

import { decodeSearchAboutResponses } from "../dist/protocol/responses/search-about.js";

test("decodeSearchAboutResponses extracts structured results", () => {
  const decoded = decodeSearchAboutResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "SearchAbout",
        search: "Nat",
        results: [
          { name: "double", term: "Nat -> Nat" },
          { name: "zero", term: "Nat" },
        ],
      },
    },
  ]);

  assert.equal(decoded.query, "Nat");
  assert.deepEqual(decoded.results, [
    { name: "double", term: "Nat -> Nat" },
    { name: "zero", term: "Nat" },
  ]);
});

test("decodeSearchAboutResponses ignores malformed and unrelated payloads", () => {
  const decoded = decodeSearchAboutResponses([
    { kind: "RunningInfo", message: "busy" },
    {
      kind: "DisplayInfo",
      info: {
        kind: "Other",
        results: [{ name: "ignored", term: "ignored" }],
      },
    },
    {
      kind: "DisplayInfo",
      info: {
        kind: "SearchAbout",
        search: "Nat",
        results: [
          { bad: true },
          { name: "ok", term: "Nat" },
        ],
      },
    },
  ]);

  assert.equal(decoded.query, "Nat");
  assert.deepEqual(decoded.results, [{ name: "ok", term: "Nat" }]);
});
