import test from "node:test";
import assert from "node:assert/strict";

import {
  collectOfficialReferenceLinks,
  decodeHtmlEntities,
  extractOfficialReferenceSummary,
  pageIdFromUrl,
  prettifyOfficialHtml,
} from "../../../dist/protocol/official-reference-cache.js";

const policy = {
  maxDepth: 1,
  maxPages: 64,
  allowedOrigins: ["https://agda.github.io"],
  includePathPrefixes: ["/agda/Agda-"],
  excludePathPrefixes: ["/agda/src/"],
  includeExtensions: [".html"],
};

test("pageIdFromUrl derives a stable filesystem-safe id", () => {
  assert.equal(
    pageIdFromUrl("https://agda.github.io/agda/Agda-Interaction-JSON.html"),
    "agda__Agda-Interaction-JSON",
  );
});

test("decodeHtmlEntities decodes common and numeric entities", () => {
  assert.equal(decodeHtmlEntities("&lt;Cmd_load&#62;&#x2192;&nbsp;ok"), "<Cmd_load>→ ok");
});

test("prettifyOfficialHtml breaks one-line HTML into readable lines", () => {
  const pretty = prettifyOfficialHtml("<html><body><h1>Agda</h1><p>JSON</p></body></html>");

  assert.match(pretty, /<html>\n<body>/);
  assert.match(pretty, /<\/h1>\n<p>/);
});

test("extractOfficialReferenceSummary extracts title, headings, and readable text", () => {
  const summary = extractOfficialReferenceSummary(
    "https://agda.github.io/agda/Agda-Main.html",
    "<html><head><title>Agda Main</title></head><body><h1>Overview</h1><p>Cmd_load &amp; Cmd_metas</p></body></html>",
  );

  assert.equal(summary.title, "Agda Main");
  assert.deepEqual(summary.headings, ["Overview"]);
  assert.match(summary.text, /Cmd_load & Cmd_metas/);
});

test("collectOfficialReferenceLinks keeps official HTML links and drops noise", () => {
  const links = collectOfficialReferenceLinks(
    "https://agda.github.io/agda/Agda-Main.html",
    [
      '<a href="Agda-Interaction-JSON.html">JSON</a>',
      '<a href="/agda/src/Agda-Interaction-JSON.html">src</a>',
      '<a href="https://example.com/Agda-Interaction-JSON.html">external</a>',
      '<a href="#local-anchor">local</a>',
      '<a href="Agda-Interaction-Library.html#libraries">library</a>',
    ].join(""),
    policy,
  );

  assert.deepEqual(links, [
    "https://agda.github.io/agda/Agda-Interaction-JSON.html",
    "https://agda.github.io/agda/Agda-Interaction-Library.html",
  ]);
});
