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
import { realpathSync } from "node:fs";
import { z } from "zod";

import { AgdaSession } from "../agda-process.js";
import { PathSandboxError, resolveExistingPathWithinRoot } from "../repo-root.js";
import { registerTextTool } from "../tools/tool-helpers.js";
import { applyTextEdit } from "./apply-proof-edit.js";
import { reloadAndDiagnose } from "./reload-and-diagnose.js";

/**
 * Extensions that Agda recognizes as source files. `agda_apply_edit`
 * is scoped to these — an agent with the tool can modify Agda code
 * inside the project root, but cannot use the same primitive to
 * rewrite `.git/config`, `package.json`, `Makefile`, shell scripts,
 * or anything else it happens to find lexically under the repo.
 * This is the blast-radius half of the sandbox; path containment
 * (via `resolveExistingPathWithinRoot`) is the other half.
 *
 * Covers the literate variants agda-mode currently supports. If
 * Agda adds another literate backend, add it here (and to
 * parse-load-responses.ts's error-location regex for consistency).
 */
export const AGDA_SOURCE_EXTENSIONS = [
  ".agda",
  ".lagda",
  ".lagda.md",
  ".lagda.rst",
  ".lagda.tex",
  ".lagda.org",
  ".lagda.typ",
] as const;

export function hasAgdaSourceExtension(path: string): boolean {
  // Compare against the lowercase filename so `Foo.AGDA` is
  // accepted on case-insensitive filesystems; the containment
  // check uses the real on-disk path anyway.
  const lower = path.toLowerCase();
  return AGDA_SOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Canonicalize `session.currentFile` for identity comparison. The
 * session's path is set by `agda_load`, which does not realpath —
 * so a direct `===` against a just-realpathed target would miss
 * symlink and `..` equivalences. If realpath fails (e.g. the
 * session file was deleted externally), fall back to the literal
 * string so the comparison is at least self-consistent.
 */
function canonicalizeLoadedFile(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function registerAgdaApplyEdit(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  // Deliberately do NOT pass `session` to registerTextTool here: that
  // would enable sessionErrorStateGate, which refuses to run tools when
  // the last load classification is `type-error`. agda_apply_edit is
  // precisely the tool an agent needs to repair a file that failed to
  // load, so gating it there would be counterproductive.
  registerTextTool({
    server,
    name: "agda_apply_edit",
    description:
      "Apply a targeted text substitution to an Agda file and reload it. For edits that aren't goal actions — adding imports, renaming symbols, fixing typos. oldText must match exactly once unless `occurrence` is provided. Auto-reloads the file after writing so the Agda session stays in sync. Runs even when the session is in a type-error state, since the whole point is to repair that state.",
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
      // Resolve AND canonicalize within the project root. Unlike the
      // lexical-only `resolveFileWithinRoot`, this helper runs
      // `realpath` on the target and verifies the canonical path is
      // still inside the canonical root — so a symlink that lexically
      // lives under the project root but physically points outside
      // can't be used to escape the sandbox when we write to disk.
      // The returned canonical path is also the form we want to hand
      // to `session.load()` so `session.currentFile` stays canonical
      // for future reload-detection.
      let canonicalPath: string;
      try {
        canonicalPath = resolveExistingPathWithinRoot(repoRoot, file as string);
      } catch (err) {
        if (err instanceof PathSandboxError) {
          return `## agda_apply_edit\n\n**Error:** ${err.message}\n`;
        }
        // realpath failure (ENOENT, permissions, etc.) — the file
        // either doesn't exist yet or is unreadable. Surface a
        // structured failure rather than throwing.
        const msg = err instanceof Error ? err.message : String(err);
        return `## agda_apply_edit\n\n**Error:** Could not resolve file path: ${msg}\n`;
      }

      // Extension allowlist: agda_apply_edit is meant for Agda
      // source files only. Without this check, an agent with the
      // tool could rewrite .git/config, package.json, Makefile,
      // shell scripts, or anything else lexically inside the repo.
      // Checking the canonical (post-realpath) path prevents a
      // ".agda" suffix trick like `shell.sh/..%2f/foo.agda` from
      // bypassing the check.
      if (!hasAgdaSourceExtension(canonicalPath)) {
        return (
          `## agda_apply_edit\n\n` +
          `**Error:** Refusing to edit \`${file}\`: agda_apply_edit is ` +
          `restricted to Agda source files (${AGDA_SOURCE_EXTENSIONS.join(", ")}). ` +
          `Use a general-purpose file-editing tool for non-Agda files.\n`
        );
      }

      // Capture goal IDs before the edit so the reload can report a
      // {solved, new} diff. Only meaningful when the edited file is
      // the currently loaded one — otherwise the "before" set is
      // empty and the diff degenerates to "all new".
      //
      // session.currentFile is whatever `agda_load` happened to be
      // called with, which may be non-canonical. Canonicalize it
      // before comparing so symlink and `..` differences don't cause
      // us to miss the "is this the loaded file?" check.
      const canonicalLoaded = session.currentFile
        ? canonicalizeLoadedFile(session.currentFile)
        : null;
      const isLoadedFile = canonicalLoaded === canonicalPath;
      const goalIdsBefore = isLoadedFile ? session.getGoalIds() : undefined;

      const editResult = await applyTextEdit(
        canonicalPath,
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

      // Pass the canonical path to the reload so `session.currentFile`
      // stays in the same normalized form used by the loaded-file
      // comparison above. Without this, a later edit could feed a
      // non-canonical path to `session.load()` and break reload
      // detection on subsequent calls.
      output += await reloadAndDiagnose(session, canonicalPath, "\n", goalIdsBefore);

      return output;
    },
  });
}
