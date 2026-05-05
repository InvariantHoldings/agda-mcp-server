// MIT License — see LICENSE
//
// Regression fence: every `agda_*` tool name appearing inside a
// nextAction hint, error message, or tool description in the source
// tree must be a real registered tool. PR #54 introduced four
// references to `agda_file_list` / `agda_search` that did not exist
// — agents following those hints would fail to find the named tool.
// This suite walks src/ and fails if any hint references a tool name
// that the runtime manifest does not know about.

import { describe, test, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AgdaSession } from "../../../src/agda-process.js";
import {
  clearToolManifest,
  listToolManifest,
} from "../../../src/tools/manifest.js";
import { registerCoreTools } from "../../../src/tools/register-core-tools.js";

const SRC_ROOT = resolve(import.meta.dirname, "..", "..", "..", "src");

let registeredNames: Set<string>;

beforeAll(() => {
  clearToolManifest();
  const server = new McpServer({ name: "test", version: "0.0.0-test" });
  const session = new AgdaSession(process.cwd());
  try {
    registerCoreTools(server, session, process.cwd());
  } finally {
    session.destroy();
  }
  registeredNames = new Set(listToolManifest().map((entry) => entry.name));
});

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("no dead `agda_*` tool references in source-string hints", () => {
  test("every backticked agda_X identifier in src/ resolves to a registered tool", () => {
    // Match `\`agda_NAME\`` inside string-literal contexts. Tool
    // names in code (imports, type unions) are excluded by the
    // backtick-and-string-literal pattern; we only flag references
    // that are quoted as tool names in user-facing prose. False
    // positives are easy to allowlist below if any creep in.
    const NAME_RX = /`(agda_[a-z][a-z0-9_]*)`/gu;

    // Names that legitimately appear in source strings but are NOT
    // registered as MCP tools — e.g. a doc reference to a hypothetical
    // future tool, or a deliberate placeholder. Empty for now;
    // additions need a one-line justification.
    const ALLOWLIST = new Set<string>();

    const offenders: Array<{ file: string; name: string; excerpt: string }> = [];
    const sources = listSourceFiles(SRC_ROOT).filter((f) => statSync(f).isFile());

    for (const file of sources) {
      const body = readFileSync(file, "utf8");
      // Strip block comments and `//` line comments so a comment
      // mentioning a tool name (which often does name retired tools
      // in TODO notes) doesn't false-positive.
      const stripped = body
        .replace(/\/\*[\s\S]*?\*\//gu, " ")
        .replace(/(^|[^:"'`/])\/\/[^\n]*/gu, (_, lead: string) => lead);

      NAME_RX.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = NAME_RX.exec(stripped)) !== null) {
        const name = match[1];
        if (registeredNames.has(name) || ALLOWLIST.has(name)) continue;
        const start = Math.max(0, match.index - 32);
        const end = Math.min(stripped.length, match.index + match[0].length + 32);
        const excerpt = stripped.slice(start, end).replace(/\s+/gu, " ").trim();
        offenders.push({
          file: file.slice(SRC_ROOT.length + 1),
          name,
          excerpt,
        });
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the registered-tool set is non-trivial", () => {
    // Without this guard, an empty manifest would make the assertion
    // above vacuously true.
    expect(registeredNames.size).toBeGreaterThan(20);
  });
});
