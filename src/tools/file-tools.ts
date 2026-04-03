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
import { PathSandboxError, resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../repo-root.js";
import { missingPathToolError, ToolInvocationError, registerTextTool } from "./tool-helpers.js";

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
    description: "Read an Agda module file and return its contents with line numbers.",
    category: "navigation",
    inputSchema: { file: z.string().describe(filePathDescription()) },
    callback: async ({ file }: { file: string }) => {
      const requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      if (!existsSync(requestedFilePath)) {
        throw missingPathToolError("file", requestedFilePath);
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      const fileContent = readFileSync(filePath, "utf-8");
      const numbered = fileContent
        .split("\n")
        .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
        .join("\n");
      return `## ${relative(repoRoot, requestedFilePath)}\n\n\`\`\`agda\n${numbered}\n\`\`\``;
    },
  });

  registerTextTool({
    server,
    name: "agda_list_modules",
    description: "List Agda modules in a directory tier (MathLib, Foundation, Kernel, Research, Extensions, etc.).",
    category: "navigation",
    inputSchema: { tier: z.string().describe("The tier to list, e.g. 'Kernel', 'Foundation', 'MathLib'") },
    callback: async ({ tier }: { tier: string }) => {
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
      const modules: string[] = [];
      function walk(dir: string, requestedDir: string, displayPrefix: string): void {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
      return `## agda/${tier} (${modules.length} modules)\n\n${modules.map((m) => `- ${m}`).join("\n")}`;
    },
  });

  registerTextTool({
    server,
    name: "agda_check_postulates",
    description: "Check an Agda file for postulate declarations. In Kernel/ files, postulates are forbidden by construction.",
    category: "navigation",
    inputSchema: { file: z.string().describe(filePathDescription()) },
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
      const matches: Array<{ file: string; line: number; text: string }> = [];
      function searchDir(dir: string, requestedDir: string, displayPrefix: string): void {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
            const lines = readFileSync(filePath, "utf-8").split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(query)) {
                matches.push({ file: nextDisplayPath, line: i + 1, text: lines[i].trim() });
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
      if (matches.length === 0) return `No matches for "${query}" in ${tier ?? "agda/"}`;
      const capped = matches.slice(0, 50);
      let output = `## Search: "${query}" (${matches.length} matches${matches.length > 50 ? ", showing first 50" : ""})\n\n`;
      for (const m of capped) output += `- **${m.file}:${m.line}** \`${m.text}\`\n`;
      return output;
    },
  });
}
