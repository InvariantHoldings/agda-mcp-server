// MIT License — see LICENSE
//
// Project-level configuration for the MCP server.
//
// Configuration sources (in priority order, highest last):
//   1. `.agda-mcp.json` at PROJECT_ROOT (file-based project defaults)
//   2. `AGDA_MCP_DEFAULT_FLAGS` env var (space-separated flags)
//   3. Per-call `commandLineOptions` (passed to agda_load/agda_typecheck)
//
// The merged result is passed as the [String] argument to Cmd_load:
//   IOTCM "<file>" NonInteractive Direct (Cmd_load "<file>" ["--flag1", ...])
//
// Reference:
//   - Agda IOTCM Cmd_load: https://github.com/agda/agda/blob/master/src/full/Agda/Interaction/BasicOps.hs
//   - Agda CLI options: https://agda.readthedocs.io/en/latest/tools/command-line-options.html
//
// Example `.agda-mcp.json`:
// {
//   "commandLineOptions": ["--Werror", "--safe"]
// }

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../agda/logger.js";

/** The config file name looked up at PROJECT_ROOT. */
export const PROJECT_CONFIG_FILENAME = ".agda-mcp.json";

/**
 * Environment variable for space-separated default Agda flags.
 * Example: AGDA_MCP_DEFAULT_FLAGS="--Werror --safe --without-K"
 */
export const ENV_DEFAULT_FLAGS = "AGDA_MCP_DEFAULT_FLAGS";

export interface ProjectConfig {
  /**
   * Default command-line options passed to every Cmd_load invocation.
   * These are merged with (and overridden by) per-call options.
   */
  commandLineOptions?: string[];
}

// ── Config caching ───────────────────────────────────────────────────
//
// The project config is read from disk on every load call. To avoid
// redundant I/O on large projects with many sequential loads, we cache
// the parsed config keyed by (projectRoot, mtime). The cache is
// invalidated when the file's mtime changes.

interface CacheEntry {
  config: ProjectConfig;
  mtimeMs: number;
}

const configCache = new Map<string, CacheEntry>();

/**
 * Invalidate the cached config for a project root.
 * Exposed for testing; production code relies on mtime-based staleness.
 */
export function invalidateProjectConfigCache(projectRoot?: string): void {
  if (projectRoot) {
    configCache.delete(projectRoot);
  } else {
    configCache.clear();
  }
}

/**
 * Load project configuration from `.agda-mcp.json` at the given root.
 *
 * Results are cached by (projectRoot, file mtime). Returns an empty
 * config if the file doesn't exist or is malformed (with a warning
 * logged for parse failures).
 *
 * Additionally reads `AGDA_MCP_DEFAULT_FLAGS` env var and merges those
 * flags into the config (env var flags come after file-based flags but
 * before per-call options).
 */
export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = join(projectRoot, PROJECT_CONFIG_FILENAME);

  let fileConfig: ProjectConfig = {};

  if (existsSync(configPath)) {
    // Check mtime-based cache
    try {
      const currentMtime = statSync(configPath).mtimeMs;
      const cached = configCache.get(projectRoot);
      if (cached && cached.mtimeMs === currentMtime) {
        fileConfig = cached.config;
      } else {
        fileConfig = parseConfigFile(configPath);
        configCache.set(projectRoot, { config: fileConfig, mtimeMs: currentMtime });
      }
    } catch {
      fileConfig = parseConfigFile(configPath);
    }
  } else {
    // No config file — clear any stale cache entry
    configCache.delete(projectRoot);
  }

  // Merge env var flags
  const envFlags = parseEnvFlags();
  if (envFlags.length === 0) {
    return fileConfig;
  }

  // Combine file-based options with env var options
  const combined = [...(fileConfig.commandLineOptions ?? []), ...envFlags];
  return { ...fileConfig, commandLineOptions: combined };
}

/**
 * Parse `AGDA_MCP_DEFAULT_FLAGS` env var into an array of flags.
 * Splits on whitespace, trims, and filters empty strings.
 */
function parseEnvFlags(): string[] {
  const raw = process.env[ENV_DEFAULT_FLAGS];
  if (!raw) return [];
  return raw.split(/\s+/u).map((s) => s.trim()).filter(Boolean);
}

function parseConfigFile(configPath: string): ProjectConfig {
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
