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
import type {
  ProjectConfigWarning,
  ProjectConfigWarningSource,
} from "./project-config.js";

/**
 * Inline prefix for a warning source. Mirrors the diagnostic `kind`
 * (`project-config-{source}`) so an agent grepping the flat message
 * text sees the same provenance the structured `kind` already encodes.
 *
 * Kept exported so callers that emit text-only output (e.g.
 * `projectConfigWarningsText`) format messages identically.
 */
export function prefixForWarningSource(source: ProjectConfigWarningSource): string {
  switch (source) {
    case "env": return "env";
    case "system": return "system";
    case "file": return "config";
  }
}

/**
 * Convert project-config warnings into structured tool diagnostics.
 *
 * Each warning becomes a `warning` diagnostic with kind
 * `project-config-{file|env|system}`. The message is prefixed with
 * the matching source label (`config:`, `env:`, `system:`) so the
 * raw message text matches the kind for agents that read either side.
 */
export function projectConfigDiagnostics(
  warnings: ReadonlyArray<ProjectConfigWarning> | undefined,
): ToolDiagnostic[] {
  if (!warnings || warnings.length === 0) return [];
  return warnings.map((w) =>
    warningDiagnostic(
      `${prefixForWarningSource(w.source)}: ${w.message}`,
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
