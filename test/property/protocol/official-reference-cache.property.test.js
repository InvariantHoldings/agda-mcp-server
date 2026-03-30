import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  collectOfficialReferenceLinks,
  extractOfficialReferenceSummary,
  prettifyOfficialHtml,
} from "../../../tooling/protocol/official-reference-cache.js";

const policy = {
  maxDepth: 1,
  maxPages: 64,
  allowedOrigins: ["https://agda.github.io"],
  includePathPrefixes: ["/agda/Agda-"],
  excludePathPrefixes: ["/agda/src/"],
  includeExtensions: [".html"],
};

test("official reference helpers are total on arbitrary HTML-ish input", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (html) => {
      const pretty = prettifyOfficialHtml(html);
      const summary = extractOfficialReferenceSummary("https://agda.github.io/agda/Agda-Main.html", html);
      const links = collectOfficialReferenceLinks("https://agda.github.io/agda/Agda-Main.html", html, policy);

      assert.equal(typeof pretty, "string");
      assert.equal(typeof summary.title, "string");
      assert.ok(Array.isArray(summary.headings));
      for (const link of links) {
        assert.match(link, /^https:\/\/agda\.github\.io\/agda\/Agda-.*\.html$/);
      }
    }),
  );
});
