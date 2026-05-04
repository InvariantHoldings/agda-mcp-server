// MIT License — see LICENSE
//
// `agda_read_module` — read a module file with line numbers, with an
// opt-in literate-extraction mode that strips prose wrappers and
// emits only the embedded Agda code blocks (preserving original line
// numbers so downstream agents can still locate fragments by line).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { z } from "zod";

import type { AgdaSession } from "../../agda-process.js";
import { filePathDescription } from "../../agda/version-support.js";
import {
  resolveExistingPathWithinRoot,
  resolveFileWithinRoot,
} from "../../repo-root.js";
import { extractLiterateCode } from "../../session/literate-extraction.js";
import { missingPathToolError, registerTextTool } from "../tool-helpers.js";

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
    outputDataSchema: z.object({
      text: z.string(),
      file: z.string(),
      lineCount: z.number(),
      literateFormat: z.string().nullable(),
      codeOnly: z.boolean(),
      codeBlockCount: z.number().nullable(),
    }),
    callback: async ({ file, codeOnly }: { file: string; codeOnly?: boolean }) => {
      const requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      if (!existsSync(requestedFilePath)) {
        throw missingPathToolError("file", requestedFilePath);
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      const fileContent = readFileSync(filePath, "utf-8");
      const canonicalRoot = resolveExistingPathWithinRoot(repoRoot, ".");
      const relPath = relative(canonicalRoot, filePath);
      const lineCount = fileContent.split("\n").length;
      const isCodeOnly = Boolean(codeOnly);

      if (isCodeOnly) {
        const extraction = extractLiterateCode(filePath, fileContent);
        if (extraction.format === null) {
          // Plain .agda — codeOnly has no effect, return as normal
          const numbered = fileContent
            .split("\n")
            .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
            .join("\n");
          return {
            text: `## ${relPath}\n\n\`\`\`agda\n${numbered}\n\`\`\``,
            data: {
              file: relPath,
              lineCount,
              literateFormat: null,
              codeOnly: true,
              codeBlockCount: null,
            },
          };
        }

        if (extraction.blocks.length === 0) {
          return {
            text: `## ${relPath} (code only)\n\nNo Agda code blocks found in this ${extraction.format} literate file.`,
            data: {
              file: relPath,
              lineCount,
              literateFormat: extraction.format,
              codeOnly: true,
              codeBlockCount: 0,
            },
          };
        }

        let output = `## ${relPath} (code only — ${extraction.format} format, ${extraction.blocks.length} block(s))\n\n`;
        for (const block of extraction.blocks) {
          const numbered = block.code
            .split("\n")
            .map((line, lineIdx) => `${String(block.startLine + lineIdx).padStart(4)} | ${line}`)
            .join("\n");
          output += `\`\`\`agda\n${numbered}\n\`\`\`\n\n`;
        }
        return {
          text: output.trimEnd(),
          data: {
            file: relPath,
            lineCount,
            literateFormat: extraction.format,
            codeOnly: true,
            codeBlockCount: extraction.blocks.length,
          },
        };
      }

      const numbered = fileContent
        .split("\n")
        .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
        .join("\n");
      return {
        text: `## ${relPath}\n\n\`\`\`agda\n${numbered}\n\`\`\``,
        data: {
          file: relPath,
          lineCount,
          literateFormat: null,
          codeOnly: false,
          codeBlockCount: null,
        },
      };
    },
  });
}
