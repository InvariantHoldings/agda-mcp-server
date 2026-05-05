// MIT License — see LICENSE
//
// `agda_list_modules` — paginated tier-scoped Agda module listing.
//
// Walks the requested tier root with sandbox + permission-tolerant
// semantics: a single unreadable subtree is reported as an explicit
// "skipped" entry rather than crashing the whole walk. Pagination
// (`offset`, `limit`, `pattern`) keeps the response small enough for
// MCP token budgets even on many-hundred-module projects.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

import type { AgdaSession } from "../../agda-process.js";
import { isAgdaSourceFile } from "../../agda/version-support.js";
import { logger } from "../../agda/logger.js";
import {
  resolveExistingPathWithinRoot,
  resolveFileWithinRoot,
} from "../../repo-root.js";
import { ToolInvocationError, registerTextTool } from "../tool-helpers.js";
import {
  LIST_MODULES_DEFAULT_LIMIT,
  LIST_MODULES_MAX_LIMIT,
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
    name: "agda_list_modules",
    description: "List Agda modules in a directory tier (MathLib, Foundation, Kernel, Research, Extensions, etc.). Always reports the total module count; paginated to keep responses small (default page size 25). Use `offset` to scroll, `limit` to enlarge the page, and `pattern` for a case-insensitive substring filter on the relative path.",
    category: "navigation",
    inputSchema: {
      tier: z.string().describe("The tier to list, e.g. 'Kernel', 'Foundation', 'MathLib'"),
      offset: z.number().int().min(0).optional().describe("0-based starting index into the sorted result list. Defaults to 0."),
      limit: z.number().int().min(1).max(LIST_MODULES_MAX_LIMIT).optional().describe(
        `Maximum number of modules to return in this page. Defaults to ${LIST_MODULES_DEFAULT_LIMIT}; capped at ${LIST_MODULES_MAX_LIMIT}.`,
      ),
      pattern: z.string().optional().describe("Case-insensitive substring filter applied to each module's relative path before pagination."),
    },
    outputDataSchema: z.object({
      text: z.string(),
      tier: z.string(),
      pattern: z.string().nullable(),
      total: z.number(),
      filtered: z.number(),
      offset: z.number(),
      limit: z.number(),
      modules: z.array(z.string()),
      hasMore: z.boolean(),
      nextOffset: z.number().nullable(),
      unreadableSubtrees: z.array(z.string()),
    }),
    callback: async ({ tier, offset, limit, pattern }: { tier: string; offset?: number; limit?: number; pattern?: string }) => {
      const requestedTierDir = resolveFileWithinRoot(repoRoot, join("agda", tier));
      if (!existsSync(requestedTierDir)) {
        throw new ToolInvocationError({
          message: `Tier directory not found: agda/${tier}`,
          classification: "not-found",
          diagnostics: [
            {
              severity: "error",
              message: `Tier directory not found: agda/${tier}`,
              code: "not-found",
              nextAction:
                "Pass an existing top-level directory under agda/ (e.g. MathLib, Foundation, Kernel, Research, Extensions, TrustedCompute). " +
                "Use `agda_search_definitions` with no `tier` to scan the whole project root if you don't know which tier to pick.",
            },
            {
              severity: "info",
              message: "Available tiers: MathLib, Foundation, Kernel, Research, Extensions, TrustedCompute",
              code: "available-tiers",
            },
          ],
          data: { tier },
          text: `Tier directory not found: agda/${tier}\nAvailable: MathLib, Foundation, Kernel, Research, Extensions, TrustedCompute`,
        });
      }
      const tierDir = resolveExistingPathWithinRoot(repoRoot, requestedTierDir);
      // Ensure version detection has run so isAgdaSourceFile() filters by the
      // actually-installed Agda's supported extensions rather than being
      // permissive (all extensions) when this tool is invoked first.
      if (!session.getAgdaVersion()) {
        try { await session.query.showVersion(); } catch (err) {
          logger.trace("agda_list_modules: version detection best-effort failed", { err });
        }
      }
      const modules: string[] = [];
      const unreadableDirs: string[] = [];
      function walk(dir: string, requestedDir: string, displayPrefix: string): void {
        let entries: import("node:fs").Dirent[];
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch (err) {
          // One unreadable subdir (permission denied, broken
          // symlink, ENOTDIR race from a concurrent rename) must
          // not crash the entire listing. Collect the path so the
          // response can tell the caller which subtrees were
          // skipped, then keep walking the siblings.
          unreadableDirs.push(displayPrefix);
          logger.trace("agda_list_modules: readdir failed, skipping subtree", { dir, err });
          return;
        }
        for (const entry of entries) {
          const nextRequestedPath = resolve(requestedDir, entry.name);
          const nextDisplayPath = join(displayPrefix, entry.name);
          if (entry.isDirectory()) walk(resolve(dir, entry.name), nextRequestedPath, nextDisplayPath);
          else if (isAgdaSourceFile(entry.name, session.getAgdaVersion() ?? undefined)) {
            const canonicalPath = resolveExistingChildWithinRoot(repoRoot, nextRequestedPath);
            if (canonicalPath) {
              modules.push(nextDisplayPath);
            }
          }
        }
      }
      walk(
        tierDir,
        requestedTierDir,
        relativeToRequestedRoot(repoRoot, requestedTierDir),
      );
      modules.sort();

      const normalizedPattern = pattern?.toLowerCase() ?? null;
      const filtered = normalizedPattern === null
        ? modules
        : modules.filter((m) => m.toLowerCase().includes(normalizedPattern));

      const effectiveOffset = offset ?? 0;
      const effectiveLimit = limit ?? LIST_MODULES_DEFAULT_LIMIT;
      const page = filtered.slice(effectiveOffset, effectiveOffset + effectiveLimit);
      const nextOffset = effectiveOffset + page.length;
      const hasMore = nextOffset < filtered.length;

      const totalLine = normalizedPattern === null
        ? `**Total:** ${modules.length} modules in \`agda/${tier}\`.`
        : `**Total:** ${filtered.length} matches for \`${pattern}\` (out of ${modules.length} modules in \`agda/${tier}\`).`;
      const rangeStart = page.length === 0 ? effectiveOffset : effectiveOffset + 1;
      const rangeEnd = effectiveOffset + page.length;
      const showingLine = page.length === 0
        ? `**Showing:** none — \`offset: ${effectiveOffset}\` is past the end (${filtered.length} total).`
        : `**Showing:** ${rangeStart}–${rangeEnd} of ${filtered.length}.`;

      const lines = [
        `## agda/${tier}`,
        "",
        totalLine,
        showingLine,
        "",
      ];
      if (page.length > 0) {
        for (const m of page) lines.push(`- ${m}`);
      }
      if (hasMore) {
        lines.push("");
        lines.push(`**More results available.** Re-call with \`offset: ${nextOffset}\` to fetch the next page.`);
      }
      if (unreadableDirs.length > 0) {
        lines.push("");
        lines.push(`**Skipped ${unreadableDirs.length} unreadable subtree(s):** ${unreadableDirs.join(", ")}. Check file permissions or broken symlinks; modules beneath these directories are not included in the total count.`);
      }
      return {
        text: lines.join("\n"),
        data: {
          tier,
          pattern: pattern ?? null,
          total: modules.length,
          filtered: filtered.length,
          offset: effectiveOffset,
          limit: effectiveLimit,
          modules: page,
          hasMore,
          nextOffset: hasMore ? nextOffset : null,
          unreadableSubtrees: unreadableDirs,
        },
      };
    },
  });
}
