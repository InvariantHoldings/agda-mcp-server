import { test, expect } from "vitest";

import {
  collectOfficialReferenceLinks,
  decodeHtmlEntities,
  extractOfficialReferenceSummary,
  pageIdFromUrl,
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

test("pageIdFromUrl derives a stable filesystem-safe id", () => {
  expect(
    pageIdFromUrl("https://agda.github.io/agda/Agda-Interaction-JSON.html"),
  ).toBe("agda__Agda-Interaction-JSON");
});

test("decodeHtmlEntities decodes common and numeric entities", () => {
  expect(decodeHtmlEntities("&lt;Cmd_load&#62;&#x2192;&nbsp;ok")).toBe("<Cmd_load>→ ok");
});

test("prettifyOfficialHtml breaks one-line HTML into readable lines", () => {
  const pretty = prettifyOfficialHtml("<html><body><h1>Agda</h1><p>JSON</p></body></html>");

  expect(pretty).toMatch(/<html>\n<body>/);
  expect(pretty).toMatch(/<\/h1>\n<p>/);
});

test("extractOfficialReferenceSummary extracts title, headings, and readable text", () => {
  const summary = extractOfficialReferenceSummary(
    "https://agda.github.io/agda/Agda-Main.html",
    "<html><head><title>Agda Main</title></head><body><h1>Overview</h1><p>Cmd_load &amp; Cmd_metas</p></body></html>",
  );

  expect(summary.title).toBe("Agda Main");
  expect(summary.headings).toEqual(["Overview"]);
  expect(summary.text).toMatch(/Cmd_load & Cmd_metas/);
});

test("extractOfficialReferenceSummary strips script and style tags even with spaced end tags", () => {
  const summary = extractOfficialReferenceSummary(
    "https://agda.github.io/agda/Agda-Main.html",
    "<html><body><script>window.bad = true;</script ><style>.x { color: red; }</style ><p>Visible text</p></body></html>",
  );

  expect(summary.text).toMatch(/Visible text/);
  expect(summary.text).not.toMatch(/window\.bad/);
  expect(summary.text).not.toMatch(/color: red/);
});

test("extractOfficialReferenceSummary strips script tags with whitespace and stray tokens before >", () => {
  const summary = extractOfficialReferenceSummary(
    "https://agda.github.io/agda/Agda-Main.html",
    "<html><body><script>window.bad = true;</script\t\n bar><p>Visible text</p></body></html>",
  );

  expect(summary.text).toMatch(/Visible text/);
  expect(summary.text).not.toMatch(/window\.bad/);
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

  expect(links).toEqual([
    "https://agda.github.io/agda/Agda-Interaction-JSON.html",
    "https://agda.github.io/agda/Agda-Interaction-Library.html",
  ]);
});
