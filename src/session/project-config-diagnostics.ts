// MIT License — see LICENSE
//
// Shared formatter for `LoadResult.projectConfigWarnings`. Used by every
// tool that surfaces a load result so config warnings are presented
// consistently across `agda_load`, `agda_typecheck`, `agda_apply_edit`,
// `agda_apply_rename`, and any future tool that reloads a file.

import {
  warningDiagnostic,
  type ToolDiagnostic,
} from "../tools/tool-helpers.js";
import type { ProjectConfigWarning } from "./project-config.js";

/**
 * Convert project-config warnings into structured tool diagnostics.
 *
 * Each warning becomes a `warning` diagnostic with kind
 * `project-config-{file|env|system}`. The message is prefixed with
 * `config:` or `env:` to make the source obvious in a flat diagnostic
 * list — the kind already encodes this, but raw message readers (e.g.
 * agents grepping a markdown summary) benefit from inline prefix too.
 */
export function projectConfigDiagnostics(
  warnings: ReadonlyArray<ProjectConfigWarning> | undefined,
): ToolDiagnostic[] {
  if (!warnings || warnings.length === 0) return [];
  return warnings.map((w) =>
    warningDiagnostic(
      `${w.source === "env" ? "env" : "config"}: ${w.message}`,
      `project-config-${w.source}`,
    ),
  );
}

/**
 * Format project-config warnings as plain text for tools that emit
 * a markdown body rather than a structured diagnostics array (e.g.
 * `agda_reload`'s text-only output).
 *
 * Returns an empty string when `warnings` is empty so callers can
 * concatenate unconditionally.
 */
export function projectConfigWarningsText(
  warnings: ReadonlyArray<ProjectConfigWarning> | undefined,
): string {
  if (!warnings || warnings.length === 0) return "";
  const lines = warnings.map((w) =>
    `- [${w.source}] ${w.message}`,
  );
  return `\n**Project-config warnings:**\n${lines.join("\n")}\n`;
}
