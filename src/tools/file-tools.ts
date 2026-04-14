// MIT License — see LICENSE
//
// File-based navigation tools: reading modules, listing modules,
// checking postulates, searching definitions (pure filesystem, no Agda session)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve, relative, join } from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import type { AgdaSession } from "../agda-process.js";
import { isAgdaSourceFile, filePathDescription } from "../agda/version-support.js";
import { logger } from "../agda/logger.js";
import { PathSandboxError, resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../repo-root.js";
import { missingPathToolError, ToolInvocationError, registerTextTool } from "./tool-helpers.js";
import { extractLiterateCode } from "../session/literate-extraction.js";

/**
 * Default page size for `agda_list_modules`. Sized so a single response
 * comfortably fits inside an MCP client's per-tool token budget on a
 * many-hundred-module project — see §2.4 of the agent UX bug report.
 */
const LIST_MODULES_DEFAULT_LIMIT = 25;
/** Hard cap so a caller can't ask for, say, 100k results in one shot. */
const LIST_MODULES_MAX_LIMIT = 500;

function relativeToRequestedRoot(repoRoot: string, requestedRoot: string, relativePath = ""): string {
  const requestedBase = relative(repoRoot, requestedRoot);
  return relativePath ? join(requestedBase, relativePath) : requestedBase;
}

function resolveExistingChildWithinRoot(repoRoot: string, path: string): string | null {
  try {
    return resolveExistingPathWithinRoot(repoRoot, path);
  } catch (error) {
    if (error instanceof PathSandboxError) {
      return null;
    }
    throw error;
  }
}

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerTextTool({
    server,
    name: "agda_read_module",
    description: "Read an Agda module file and return its contents with line numbers. For literate files (.lagda.md, .lagda.tex, etc.), use `codeOnly: true` to extract just the Agda code blocks, stripping prose wrappers.",
    category: "navigation",
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
      codeOnly: z.boolean().optional().describe("When true, extract only Agda code blocks from literate files, stripping prose. Has no effect on plain .agda files."),
    },
    callback: async ({ file, codeOnly }: { file: string; codeOnly?: boolean }) => {
      const requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      if (!existsSync(requestedFilePath)) {
        throw missingPathToolError("file", requestedFilePath);
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      const fileContent = readFileSync(filePath, "utf-8");
      const relPath = relative(repoRoot, requestedFilePath);

      if (codeOnly) {
        const extraction = extractLiterateCode(filePath, fileContent);
        if (extraction.format === null) {
          // Plain .agda — codeOnly has no effect, return as normal
          const numbered = fileContent
            .split("\n")
            .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
            .join("\n");
          return `## ${relPath}\n\n\`\`\`agda\n${numbered}\n\`\`\``;
        }

        if (extraction.blocks.length === 0) {
          return `## ${relPath} (code only)\n\nNo Agda code blocks found in this ${extraction.format} literate file.`;
        }

        let output = `## ${relPath} (code only — ${extraction.format} format, ${extraction.blocks.length} block(s))\n\n`;
        for (const block of extraction.blocks) {
          const numbered = block.code
            .split("\n")
            .map((line, lineIdx) => `${String(block.startLine + lineIdx).padStart(4)} | ${line}`)
            .join("\n");
          output += `\`\`\`agda\n${numbered}\n\`\`\`\n\n`;
        }
        return output.trimEnd();
      }

      const numbered = fileContent
        .split("\n")
        .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
        .join("\n");
      return `## ${relPath}\n\n\`\`\`agda\n${numbered}\n\`\`\``;
    },
  });

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
      return lines.join("\n");
    },
  });

  registerTextTool({
    server,
    name: "agda_check_postulates",
    description: "Check an Agda file for postulate declarations. In Kernel/ files, postulates are forbidden by construction.",
    category: "navigation",
    inputSchema: { file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)) },
    callback: async ({ file }: { file: string }) => {
      const requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      if (!existsSync(requestedFilePath)) {
        throw missingPathToolError("file", requestedFilePath);
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      const fileContent = readFileSync(filePath, "utf-8");
      const lines = fileContent.split("\n");
      const postulates: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*postulate\b/.test(lines[i])) {
          postulates.push(`Line ${i + 1}: ${lines[i].trim()}`);
        }
      }
      const relPath = relative(repoRoot, requestedFilePath);
      const isKernel = relPath.startsWith("agda/Kernel/");
      let output = `## Postulate check: ${relPath}\n\n`;
      if (postulates.length === 0) {
        output += "No postulates found. Fully constructive.\n";
      } else {
        output += `**${postulates.length} postulate(s) found**`;
        if (isKernel) output += ` **VIOLATION: postulates are forbidden in Kernel/**`;
        output += "\n\n";
        for (const p of postulates) output += `- ${p}\n`;
      }
      return output;
    },
  });

  registerTextTool({
    server,
    name: "agda_search_definitions",
    description: "Search for a definition, theorem, or type name across Agda modules.",
    category: "navigation",
    inputSchema: {
      query: z.string().describe("The name or pattern to search for"),
      tier: z.string().optional().describe("Optional tier to limit search (Kernel, Foundation, etc.)"),
    },
    callback: async ({ query, tier }: { query: string; tier?: string }) => {
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
      const matches: Array<{ file: string; line: number; text: string }> = [];
      const unreadableDirs: string[] = [];
      const unreadableFiles: string[] = [];
      function searchDir(dir: string, requestedDir: string, displayPrefix: string): void {
        let entries: import("node:fs").Dirent[];
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch (err) {
          // Same graceful-walk contract as `agda_list_modules`: one
          // unreadable subtree must not crash the search.
          unreadableDirs.push(displayPrefix);
          logger.trace("agda_search_definitions: readdir failed, skipping subtree", { dir, err });
          return;
        }
        for (const entry of entries) {
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
              // A file that readdir saw but readFile can't open
              // (permission change mid-walk, truncated mid-read) is
              // surfaced as a single "unreadable file" entry rather
              // than dropped silently or crashing the tool.
              unreadableFiles.push(nextDisplayPath);
              logger.trace("agda_search_definitions: readFile failed", { file: filePath, err });
              continue;
            }
            for (let i = 0; i < fileLines.length; i++) {
              if (fileLines[i].includes(query)) {
                matches.push({ file: nextDisplayPath, line: i + 1, text: fileLines[i].trim() });
              }
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
      if (matches.length === 0) {
        output = `No matches for "${query}" in ${tier ?? "agda/"}`;
      } else {
        const capped = matches.slice(0, 50);
        output = `## Search: "${query}" (${matches.length} matches${matches.length > 50 ? ", showing first 50" : ""})\n\n`;
        for (const m of capped) output += `- **${m.file}:${m.line}** \`${m.text}\`\n`;
      }
      if (unreadableDirs.length > 0 || unreadableFiles.length > 0) {
        output += `\n_Skipped ${unreadableDirs.length} unreadable subtree(s)`;
        if (unreadableFiles.length > 0) {
          output += ` and ${unreadableFiles.length} unreadable file(s)`;
        }
        output += `; check file permissions or broken symlinks._`;
      }
      return output;
    },
  });
}
