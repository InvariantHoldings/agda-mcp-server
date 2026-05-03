// MIT License — see LICENSE
//
// Project-level configuration for the MCP server.
//
// Configuration sources, in priority order (later wins on collision):
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
//   "$schema": "https://github.com/InvariantHoldings/agda-mcp-server/raw/main/schemas/agda-mcp.schema.json",
//   "commandLineOptions": ["--Werror", "--safe"]
// }

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../agda/logger.js";
import { validateCommandLineOptions } from "../protocol/command-line-options.js";

/** The config file name looked up at PROJECT_ROOT. */
export const PROJECT_CONFIG_FILENAME = ".agda-mcp.json";

/**
 * Environment variable for space-separated default Agda flags.
 * Example: AGDA_MCP_DEFAULT_FLAGS="--Werror --safe --without-K"
 */
export const ENV_DEFAULT_FLAGS = "AGDA_MCP_DEFAULT_FLAGS";

/**
 * Maximum allowed size for `.agda-mcp.json` in bytes. A misbehaving or
 * adversarial config would otherwise let `readFileSync` allocate
 * unbounded memory; 256 KiB is enormously larger than any plausible
 * legitimate config (a typical valid config is well under 1 KiB).
 */
export const MAX_CONFIG_FILE_BYTES = 256 * 1024;

/** Recognised top-level keys in `.agda-mcp.json`. Unknown keys produce warnings. */
const RECOGNISED_KEYS: ReadonlySet<string> = new Set([
  "$schema",
  "commandLineOptions",
]);

export type ProjectConfigWarningSource = "file" | "env" | "system";

export interface ProjectConfigWarning {
  /** Where the issue originated. */
  source: ProjectConfigWarningSource;
  /** Human-readable message suitable for surfacing through tool diagnostics. */
  message: string;
  /**
   * Optional path of the offending file (when `source === "file"`).
   * Useful for agents that want to point users at the config to fix.
   */
  path?: string;
}

export interface ProjectConfig {
  /**
   * Flags from `.agda-mcp.json`. Always defined (empty array if no file or
   * the file did not specify `commandLineOptions`). Returned in the order
   * they appeared in the file. Already validated and deduplicated.
   */
  fileFlags: string[];
  /**
   * Flags from the `AGDA_MCP_DEFAULT_FLAGS` env var. Always defined (empty
   * array if unset). Order preserved from the env var, validated and
   * deduplicated.
   */
  envFlags: string[];
  /**
   * Non-fatal issues discovered while loading the config. Examples:
   * unknown top-level keys, invalid flag syntax, oversize file. Returned
   * to callers so they can surface diagnostic warnings instead of silently
   * dropping malformed input.
   */
  warnings: ProjectConfigWarning[];
  /** Path to the config file that was read, if it exists. */
  configFilePath?: string;
}

// ── Config caching ───────────────────────────────────────────────────
//
// `.agda-mcp.json` is read from disk on every load call. To avoid
// redundant I/O on large projects with many sequential loads, we cache
// the parsed FILE layer keyed by `projectRoot`, validated against the
// current file's `mtimeMs` + `size`. Env-var flags are NOT cached —
// they are re-read from `process.env` on every call, since CI suites
// and tests routinely flip them mid-run and a cache stamped with the
// env value would silently miss those changes. (Comparing env on every
// call is essentially free — it's a single `process.env` lookup plus a
// short string split.)

interface CacheEntry {
  config: Pick<ProjectConfig, "fileFlags" | "warnings" | "configFilePath">;
  mtimeMs: number;
  size: number;
}

const configCache = new Map<string, CacheEntry>();

/**
 * Invalidate the cached config for a project root.
 * Exposed for testing; production code relies on mtime+size-based staleness.
 */
export function invalidateProjectConfigCache(projectRoot?: string): void {
  if (projectRoot) {
    configCache.delete(projectRoot);
  } else {
    configCache.clear();
  }
}

/**
 * Load project configuration from `.agda-mcp.json` at the given root and
 * the `AGDA_MCP_DEFAULT_FLAGS` env var.
 *
 * File-based flag results are cached by (projectRoot, mtime, size). Env
 * var flags are read fresh every call (cheap; tests and CI flip them).
 *
 * Never throws: malformed input is downgraded to a warning so a broken
 * project config can't take down every `agda_load` call.
 */
export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = join(projectRoot, PROJECT_CONFIG_FILENAME);
  const fromFile = readFileLayer(projectRoot, configPath);
  const fromEnv = readEnvLayer();

  return {
    fileFlags: fromFile.fileFlags,
    envFlags: fromEnv.envFlags,
    warnings: [...fromFile.warnings, ...fromEnv.warnings],
    configFilePath: fromFile.configFilePath,
  };
}

/**
 * The combined project-level flags in priority order: file flags first,
 * then env flags. This is what `session.load()` consumes (combined with
 * per-call options via `mergeCommandLineOptions`).
 */
export function effectiveProjectFlags(config: ProjectConfig): string[] {
  return [...config.fileFlags, ...config.envFlags];
}

function readFileLayer(
  projectRoot: string,
  configPath: string,
): Pick<ProjectConfig, "fileFlags" | "warnings" | "configFilePath"> {
  if (!existsSync(configPath)) {
    configCache.delete(projectRoot);
    return { fileFlags: [], warnings: [] };
  }

  let stat;
  try {
    stat = statSync(configPath);
  } catch (err) {
    return {
      fileFlags: [],
      warnings: [{
        source: "file",
        message: `Failed to stat .agda-mcp.json: ${err instanceof Error ? err.message : String(err)}`,
        path: configPath,
      }],
      configFilePath: configPath,
    };
  }

  const cached = configCache.get(projectRoot);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return { ...cached.config, configFilePath: configPath };
  }

  if (stat.size > MAX_CONFIG_FILE_BYTES) {
    const layer = {
      fileFlags: [] as string[],
      warnings: [{
        source: "file" as const,
        message:
          `.agda-mcp.json is ${stat.size} bytes; refusing to read files larger than ` +
          `${MAX_CONFIG_FILE_BYTES} bytes. Trim the config or remove it.`,
        path: configPath,
      }],
      configFilePath: configPath,
    };
    configCache.set(projectRoot, { config: layer, mtimeMs: stat.mtimeMs, size: stat.size });
    return layer;
  }

  const layer = parseConfigFile(configPath);
  configCache.set(projectRoot, { config: layer, mtimeMs: stat.mtimeMs, size: stat.size });
  return layer;
}

function readEnvLayer(): Pick<ProjectConfig, "envFlags" | "warnings"> {
  const raw = parseEnvFlags();
  if (raw.length === 0) return { envFlags: [], warnings: [] };

  const validation = validateCommandLineOptions(raw);
  const warnings: ProjectConfigWarning[] = [];
  for (const error of validation.errors) {
    warnings.push({
      source: "env",
      message: `${ENV_DEFAULT_FLAGS}: ${error}`,
    });
  }
  return { envFlags: validation.options, warnings };
}

/**
 * Parse `AGDA_MCP_DEFAULT_FLAGS` env var into an array of flag strings.
 * Splits on whitespace and filters empty strings. Does NOT validate flag
 * syntax — see `loadProjectConfig` / `validateCommandLineOptions` for
 * validation.
 */
export function parseEnvFlags(): string[] {
  const raw = process.env[ENV_DEFAULT_FLAGS];
  if (!raw) return [];
  return raw.split(/\s+/u).filter(Boolean);
}

function parseConfigFile(
  configPath: string,
): Pick<ProjectConfig, "fileFlags" | "warnings" | "configFilePath"> {
  const result: Pick<ProjectConfig, "fileFlags" | "warnings" | "configFilePath"> = {
    fileFlags: [],
    warnings: [],
    configFilePath: configPath,
  };
  const warn = (message: string) => {
    result.warnings.push({ source: "file", message, path: configPath });
  };

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    warn(`Failed to read .agda-mcp.json: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // Strip a UTF-8 BOM if present — JSON.parse rejects it on every Node
  // version we support, so a config saved by a Windows editor would
  // otherwise be silently dropped.
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warn(`Invalid JSON in .agda-mcp.json: ${err instanceof Error ? err.message : String(err)}`);
    logger.warn("Failed to parse .agda-mcp.json", { path: configPath });
    return result;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warn("Invalid .agda-mcp.json: expected a top-level JSON object.");
    return result;
  }

  const obj = parsed as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!RECOGNISED_KEYS.has(key)) {
      warn(
        `Unknown key '${key}' in .agda-mcp.json. Recognised keys: ${[...RECOGNISED_KEYS].join(", ")}.`,
      );
    }
  }

  if ("commandLineOptions" in obj) {
    const value = obj.commandLineOptions;
    if (!Array.isArray(value)) {
      warn("'commandLineOptions' must be an array of strings.");
    } else if (!value.every((item: unknown) => typeof item === "string")) {
      warn("'commandLineOptions' must contain only strings.");
    } else {
      const validation = validateCommandLineOptions(value);
      for (const error of validation.errors) {
        warn(error);
      }
      result.fileFlags = validation.options;
    }
  }

  return result;
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
