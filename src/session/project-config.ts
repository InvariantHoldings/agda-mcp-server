// MIT License — see LICENSE
//
// Project-level configuration for the MCP server.
//
// Supports `.agda-mcp.json` at the project root. This file lets users
// configure default Agda flags that apply to every load without
// requiring per-call `commandLineOptions` arguments.
//
// Example `.agda-mcp.json`:
// {
//   "commandLineOptions": ["--Werror", "--safe"]
// }

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../agda/logger.js";

/** The config file name looked up at PROJECT_ROOT. */
export const PROJECT_CONFIG_FILENAME = ".agda-mcp.json";

export interface ProjectConfig {
  /**
   * Default command-line options passed to every Cmd_load invocation.
   * These are merged with (and overridden by) per-call options.
   */
  commandLineOptions?: string[];
}

/**
 * Load project configuration from `.agda-mcp.json` at the given root.
 *
 * Returns an empty config if the file doesn't exist or is malformed
 * (with a warning logged for parse failures).
 */
export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = join(projectRoot, PROJECT_CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      logger.warn("Invalid .agda-mcp.json: expected a JSON object", { path: configPath });
      return {};
    }

    const obj = parsed as Record<string, unknown>;
    const result: ProjectConfig = {};

    if ("commandLineOptions" in obj) {
      if (Array.isArray(obj.commandLineOptions) &&
          obj.commandLineOptions.every((item: unknown) => typeof item === "string")) {
        result.commandLineOptions = obj.commandLineOptions as string[];
      } else {
        logger.warn(
          "Invalid .agda-mcp.json: 'commandLineOptions' must be an array of strings",
          { path: configPath },
        );
      }
    }

    return result;
  } catch (err) {
    logger.warn("Failed to parse .agda-mcp.json", {
      path: configPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

/**
 * Merge project-level defaults with per-call options.
 * Per-call options take precedence (appear later in the list).
 * Duplicates are deduplicated preserving the last occurrence.
 */
export function mergeCommandLineOptions(
  projectDefaults: string[] | undefined,
  perCallOptions: string[] | undefined,
): string[] {
  const combined = [...(projectDefaults ?? []), ...(perCallOptions ?? [])];
  // Deduplicate preserving last occurrence (per-call wins)
  const seen = new Set<string>();
  const result: string[] = [];
  for (let i = combined.length - 1; i >= 0; i--) {
    const opt = combined[i];
    if (!seen.has(opt)) {
      seen.add(opt);
      result.unshift(opt);
    }
  }
  return result;
}
