// MIT License — see LICENSE
//
// `agda_search_definitions` — substring or type-pattern search across
// Agda source files in the project, scoped optionally to a tier.
// Hard-capped at 5000 raw matches and 50 visible matches per call so
// a pathological query (e.g. `pattern: " "`) on a huge repo cannot
// exhaust memory or stall the server. Permission-tolerant: a single
// unreadable subtree or file is reported as "skipped" rather than
// crashing the whole search.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

import type { AgdaSession } from "../../agda-process.js";
import { matchesTypePattern } from "../../agda/agent-ux.js";
import { isAgdaSourceFile } from "../../agda/version-support.js";
import { logger } from "../../agda/logger.js";
import {
  resolveExistingPathWithinRoot,
  resolveFileWithinRoot,
} from "../../repo-root.js";
import {
  ToolInvocationError,
  missingPathToolError,
  registerTextTool,
} from "../tool-helpers.js";
import {
  relativeToRequestedRoot,
  resolveExistingChildWithinRoot,
} from "./shared.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerTextTool({
    server,
    name: "agda_search_definitions",
    description: "Search for a definition, theorem, or type name across Agda modules.",
    category: "navigation",
    // Pure filesystem grep across the project — no Agda session
    // required. Surface in the unloaded list so this is reachable
    // from a missing-file recovery hint without first loading.
    requiresLoadedSession: false,
    inputSchema: {
      query: z.string().optional().describe("The name or pattern to search for"),
      typePattern: z.string().optional().describe("Type-shape query (wildcard `_` supported), e.g. `_ ≤ _ + _`"),
      tier: z.string().optional().describe("Optional tier to limit search (Kernel, Foundation, etc.)"),
    },
    outputDataSchema: z.object({
      text: z.string(),
      mode: z.enum(["name", "type-pattern"]),
      query: z.string(),
      tier: z.string().nullable(),
      matchCount: z.number(),
      shown: z.number(),
      truncated: z.boolean(),
      matches: z.array(z.object({
        file: z.string(),
        line: z.number(),
        text: z.string(),
      })),
      unreadableSubtrees: z.array(z.string()),
      unreadableFiles: z.array(z.string()),
    }),
    callback: async ({ query, typePattern, tier }: { query?: string; typePattern?: string; tier?: string }) => {
      const mode: "name" | "type-pattern" = typePattern ? "type-pattern" : "name";
      const actualQuery = (typePattern ?? query ?? "").trim();
      if (actualQuery.length === 0) {
        throw new ToolInvocationError({
          message: "Provide either `query` or `typePattern`.",
          classification: "invalid-input",
          diagnostics: [
            {
              severity: "error",
              message: "Provide either `query` or `typePattern`.",
              code: "invalid-input",
              nextAction:
                "Pass `query` for a substring search across module / definition names, or `typePattern` for a token-pattern match against type signatures (e.g. `Nat → _ → Nat`).",
            },
          ],
          data: { query: actualQuery, tier },
        });
      }
      const requestedSearchRoot = tier
        ? resolveFileWithinRoot(repoRoot, join("agda", tier))
        : resolveFileWithinRoot(repoRoot, "agda");
      if (!existsSync(requestedSearchRoot)) {
        throw missingPathToolError("directory", requestedSearchRoot);
      }
      const searchRoot = resolveExistingPathWithinRoot(repoRoot, requestedSearchRoot);
      // Ensure version detection has run so isAgdaSourceFile() filters by the
      // actually-installed Agda's supported extensions rather than being
      // permissive (all extensions) when this tool is invoked first.
      if (!session.getAgdaVersion()) {
        try { await session.query.showVersion(); } catch (err) {
          logger.trace("agda_search_definitions: version detection best-effort failed", { err });
        }
      }
      // Hard cap on the matches array so a pathological query on a
      // huge repo can't OOM the server. The visible cap (slice(0, 50))
      // is much lower; this is the memory-safety backstop.
      // 5000 matches × ~200 bytes/entry ≈ 1MB.
      const MAX_RAW_MATCHES = 5000;
      const matches: Array<{ file: string; line: number; text: string }> = [];
      const unreadableDirs: string[] = [];
      const unreadableFiles: string[] = [];
      let truncatedAtCap = false;
      function searchDir(dir: string, requestedDir: string, displayPrefix: string): void {
        // Short-circuit the entire walk once we hit the cap. Without
        // this, a broad query on a huge repo continues recursing into
        // sibling subtrees and reading more files even after `matches`
        // is already full. Bail at the directory boundary so an entire
        // skipped subtree stops at one stat instead of N reads.
        if (truncatedAtCap) return;
        let entries: import("node:fs").Dirent[];
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch (err) {
          unreadableDirs.push(displayPrefix);
          logger.trace("agda_search_definitions: readdir failed, skipping subtree", { dir, err });
          return;
        }
        for (const entry of entries) {
          if (truncatedAtCap) return;
          const nextRequestedPath = resolve(requestedDir, entry.name);
          const nextDisplayPath = join(displayPrefix, entry.name);
          if (entry.isDirectory()) {
            searchDir(resolve(dir, entry.name), nextRequestedPath, nextDisplayPath);
          }
          else if (isAgdaSourceFile(entry.name, session.getAgdaVersion() ?? undefined)) {
            const filePath = resolveExistingChildWithinRoot(repoRoot, nextRequestedPath);
            if (!filePath) {
              continue;
            }
            let fileLines: string[];
            try {
              fileLines = readFileSync(filePath, "utf-8").split("\n");
            } catch (err) {
              unreadableFiles.push(nextDisplayPath);
              logger.trace("agda_search_definitions: readFile failed", { file: filePath, err });
              continue;
            }
            for (let i = 0; i < fileLines.length; i++) {
              if (matches.length >= MAX_RAW_MATCHES) {
                truncatedAtCap = true;
                return;
              }
              const line = fileLines[i];
              if (mode === "name") {
                if (!line.includes(actualQuery)) continue;
                matches.push({ file: nextDisplayPath, line: i + 1, text: line.trim() });
                continue;
              }
              if (!line.includes(":")) continue;
              const typePart = line.split(":").slice(1).join(":").trim();
              if (!matchesTypePattern(typePart, actualQuery)) continue;
              matches.push({ file: nextDisplayPath, line: i + 1, text: line.trim() });
            }
          }
        }
      }
      searchDir(
        searchRoot,
        requestedSearchRoot,
        relativeToRequestedRoot(repoRoot, requestedSearchRoot),
      );
      let output: string;
      const capped = matches.slice(0, 50);
      if (matches.length === 0) {
        output = mode === "name"
          ? `No matches for "${actualQuery}" in ${tier ?? "agda/"}`
          : `No type-pattern matches for "${actualQuery}" in ${tier ?? "agda/"}`;
      } else {
        output = `## Search (${mode}): "${actualQuery}" (${matches.length} matches${matches.length > 50 ? ", showing first 50" : ""})\n\n`;
        for (const m of capped) output += `- **${m.file}:${m.line}** \`${m.text}\`\n`;
      }
      if (unreadableDirs.length > 0 || unreadableFiles.length > 0) {
        output += `\n_Skipped ${unreadableDirs.length} unreadable subtree(s)`;
        if (unreadableFiles.length > 0) {
          output += ` and ${unreadableFiles.length} unreadable file(s)`;
        }
        output += `; check file permissions or broken symlinks._`;
      }
      if (truncatedAtCap) {
        output += `\n_Truncated at ${MAX_RAW_MATCHES} raw matches; refine the query to see the rest._`;
      }
      return {
        text: output,
        data: {
          mode,
          query: actualQuery,
          tier: tier ?? null,
          matchCount: matches.length,
          shown: capped.length,
          truncated: truncatedAtCap,
          matches: capped,
          unreadableSubtrees: unreadableDirs,
          unreadableFiles,
        },
      };
    },
  });
}
