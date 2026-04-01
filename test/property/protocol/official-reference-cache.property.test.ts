import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

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

      expect(typeof pretty).toBe("string");
      expect(typeof summary.title).toBe("string");
      expect(Array.isArray(summary.headings)).toBeTruthy();
      for (const link of links) {
        const parsed = new URL(link);
        expect(parsed.origin).toBe("https://agda.github.io");
        expect(parsed.pathname.startsWith("/agda/Agda-")).toBeTruthy();
        expect(parsed.pathname.endsWith(".html")).toBeTruthy();
      }
    }),
  );
});
