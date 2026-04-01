import { test, expect } from "vitest";

import { decodeSearchAboutResponses } from "../../../src/protocol/responses/search-about.js";

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

  expect(decoded.query).toBe("Nat");
  expect(decoded.results).toEqual([
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

  expect(decoded.query).toBe("Nat");
  expect(decoded.results).toEqual([{ name: "ok", term: "Nat" }]);
});
