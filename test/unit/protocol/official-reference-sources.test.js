import test from "node:test";
import assert from "node:assert/strict";

import { listOfficialReferenceSources } from "../../../dist/protocol/official-reference.js";

test("official reference sources are unique and official", () => {
  const sources = listOfficialReferenceSources();

  assert.ok(sources.length >= 4);
  assert.equal(new Set(sources.map((source) => source.id)).size, sources.length);
  assert.equal(new Set(sources.map((source) => source.filename)).size, sources.length);

  for (const source of sources) {
    assert.match(source.url, /^https:\/\/agda\.github\.io\//);
    assert.ok(source.description.length > 0);
  }
});
