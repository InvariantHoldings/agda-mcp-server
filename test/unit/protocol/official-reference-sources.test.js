import test from "node:test";
import assert from "node:assert/strict";

import {
  getOfficialReferenceCachePolicy,
  listOfficialReferenceSources,
} from "../../../dist/protocol/official-reference.js";

test("official reference sources are unique and official", () => {
  const sources = listOfficialReferenceSources();
  const policy = getOfficialReferenceCachePolicy();

  assert.ok(sources.length >= 4);
  assert.equal(new Set(sources.map((source) => source.id)).size, sources.length);
  assert.equal(new Set(sources.map((source) => source.slug)).size, sources.length);
  assert.ok(policy.maxDepth >= 1);
  assert.ok(policy.maxPages >= sources.length);
  assert.ok(policy.allowedOrigins.includes("https://agda.github.io"));
  assert.ok(policy.includePathPrefixes.includes("/agda/Agda-"));

  for (const source of sources) {
    assert.match(source.url, /^https:\/\/agda\.github\.io\//);
    assert.ok(source.description.length > 0);
    assert.ok(source.tags.length > 0);
  }
});
