// MIT License — see LICENSE
//
// File-based navigation tools: reading modules, listing modules,
// checking postulates, searching definitions (pure filesystem, no Agda session)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve, relative } from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import type { AgdaSession } from "../agda-process.js";
import { missingPathToolError, ToolInvocationError, registerTextTool } from "./tool-helpers.js";

export function register(
  server: McpServer,
  _session: AgdaSession,
  repoRoot: string,
): void {
  registerTextTool({
    server,
    name: "agda_read_module",
    description: "Read an Agda module file and return its contents with line numbers.",
    category: "navigation",
    inputSchema: { file: z.string().describe("Path to the .agda file") },
    callback: async ({ file }: { file: string }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        throw missingPathToolError("file", filePath);
      }
      const fileContent = readFileSync(filePath, "utf-8");
      const numbered = fileContent
        .split("\n")
        .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
        .join("\n");
      return `## ${relative(repoRoot, filePath)}\n\n\`\`\`agda\n${numbered}\n\`\`\``;
    },
  });

  registerTextTool({
    server,
    name: "agda_list_modules",
    description: "List Agda modules in a directory tier (MathLib, Foundation, Kernel, Research, Extensions, etc.).",
    category: "navigation",
    inputSchema: { tier: z.string().describe("The tier to list, e.g. 'Kernel', 'Foundation', 'MathLib'") },
    callback: async ({ tier }: { tier: string }) => {
      const tierDir = resolve(repoRoot, "agda", tier);
      if (!existsSync(tierDir)) {
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
      const modules: string[] = [];
      function walk(dir: string): void {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) walk(resolve(dir, entry.name));
          else if (entry.name.endsWith(".agda"))
            modules.push(relative(repoRoot, resolve(dir, entry.name)));
        }
      }
      walk(tierDir);
      modules.sort();
      return `## agda/${tier} (${modules.length} modules)\n\n${modules.map((m) => `- ${m}`).join("\n")}`;
    },
  });

  registerTextTool({
    server,
    name: "agda_check_postulates",
    description: "Check an Agda file for postulate declarations. In Kernel/ files, postulates are forbidden by construction.",
    category: "navigation",
    inputSchema: { file: z.string().describe("Path to the .agda file") },
    callback: async ({ file }: { file: string }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        throw missingPathToolError("file", filePath);
      }
      const fileContent = readFileSync(filePath, "utf-8");
      const lines = fileContent.split("\n");
      const postulates: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*postulate\b/.test(lines[i])) {
          postulates.push(`Line ${i + 1}: ${lines[i].trim()}`);
        }
      }
      const relPath = relative(repoRoot, filePath);
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
      const searchRoot = tier ? resolve(repoRoot, "agda", tier) : resolve(repoRoot, "agda");
      if (!existsSync(searchRoot)) {
        throw missingPathToolError("directory", searchRoot);
      }
      const matches: Array<{ file: string; line: number; text: string }> = [];
      function searchDir(dir: string): void {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) searchDir(resolve(dir, entry.name));
          else if (entry.name.endsWith(".agda")) {
            const fp = resolve(dir, entry.name);
            const lines = readFileSync(fp, "utf-8").split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(query)) {
                matches.push({ file: relative(repoRoot, fp), line: i + 1, text: lines[i].trim() });
              }
            }
          }
        }
      }
      searchDir(searchRoot);
      if (matches.length === 0) return `No matches for "${query}" in ${tier ?? "agda/"}`;
      const capped = matches.slice(0, 50);
      let output = `## Search: "${query}" (${matches.length} matches${matches.length > 50 ? ", showing first 50" : ""})\n\n`;
      for (const m of capped) output += `- **${m.file}:${m.line}** \`${m.text}\`\n`;
      return output;
    },
  });
}
