import { test, expect } from "vitest";

import {
  getOfficialReferenceCachePolicy,
  listOfficialReferenceSources,
} from "../../../tooling/protocol/official-reference.js";

test("official reference sources are unique and official", () => {
  const sources = listOfficialReferenceSources();
  const policy = getOfficialReferenceCachePolicy();

  expect(sources.length >= 4).toBeTruthy();
  expect(new Set(sources.map((source) => source.id)).size).toBe(sources.length);
  expect(new Set(sources.map((source) => source.slug)).size).toBe(sources.length);
  expect(policy.maxDepth >= 1).toBeTruthy();
  expect(policy.maxPages >= sources.length).toBeTruthy();
  expect(policy.allowedOrigins.includes("https://agda.github.io")).toBeTruthy();
  expect(policy.includePathPrefixes.includes("/agda/Agda-")).toBeTruthy();

  for (const source of sources) {
    const sourceUrl = new URL(source.url);
    expect(sourceUrl.origin).toBe("https://agda.github.io");
    expect(policy.includePathPrefixes.some((prefix) => sourceUrl.pathname.startsWith(prefix))).toBeTruthy();
    expect(source.description.length > 0).toBeTruthy();
    expect(source.tags.length > 0).toBeTruthy();
  }
});
