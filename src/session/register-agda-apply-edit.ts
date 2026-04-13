// MIT License — see LICENSE
//
// agda_apply_edit tool registration.
//
// `agda_apply_edit` is a round-trip primitive for non-goal edits: adding
// imports, renaming symbols, fixing typos, etc. It substitutes `oldText`
// with `newText` in the named file, then reloads the file so the Agda
// session's view stays coherent with on-disk state.
//
// This closes the gap described in docs/bug-reports/agent-ux-observations.md
// §7: agents previously had to round-trip through a separate Edit call,
// and any missed Edit silently desynchronized the server state from disk.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "node:fs";
import { z } from "zod";

import { AgdaSession } from "../agda-process.js";
import { resolveFileWithinRoot } from "../repo-root.js";
import { registerTextTool } from "../tools/tool-helpers.js";
import { applyTextEdit } from "./apply-proof-edit.js";
import { reloadAndDiagnose } from "./reload-and-diagnose.js";

export function registerAgdaApplyEdit(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerTextTool({
    server,
    session,
    name: "agda_apply_edit",
    description:
      "Apply a targeted text substitution to an Agda file and reload it. For edits that aren't goal actions — adding imports, renaming symbols, fixing typos. oldText must match exactly once unless `occurrence` is provided. Auto-reloads the file after writing so the Agda session stays in sync.",
    category: "session",
    inputSchema: {
      file: z.string().describe("Path to the .agda file (relative to repo root or absolute)"),
      oldText: z.string().describe("Exact text to replace. Must match once (or specify `occurrence`)."),
      newText: z.string().describe("Replacement text."),
      occurrence: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-based occurrence number when oldText appears multiple times."),
    },
    callback: async ({ file, oldText, newText, occurrence }) => {
      const resolvedPath = resolveFileWithinRoot(repoRoot, file as string);
      if (!existsSync(resolvedPath)) {
        return `## agda_apply_edit\n\n**Error:** File not found: ${file}\n`;
      }

      // Capture goal IDs before the edit so the reload can report a
      // {solved, new} diff. Only meaningful when the edited file is the
      // currently loaded one — otherwise the "before" set is empty and
      // the diff degenerates to "all new".
      const isLoadedFile = session.currentFile === resolvedPath;
      const goalIdsBefore = isLoadedFile ? session.getGoalIds() : undefined;

      const editResult = await applyTextEdit(
        resolvedPath,
        oldText as string,
        newText as string,
        { occurrence: occurrence as number | undefined },
      );

      let output = `## Apply edit to \`${file}\`\n\n`;

      if (!editResult.applied) {
        output += `**Edit not applied:** ${editResult.message}\n`;
        return output;
      }

      output += `${editResult.message}\n`;

      // Reload to resync session state with the new on-disk file.
      // If this file is the currently loaded one, session.currentFile
      // is updated; otherwise session.load() sets it to the edited file.
      output += await reloadAndDiagnose(session, resolvedPath, "\n", goalIdsBefore);

      return output;
    },
  });
}
