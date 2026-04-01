import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT_ENV_VAR = "AGDA_MCP_ROOT";

export function resolveServerRepoRoot(moduleUrl = import.meta.url): string {
  const moduleDir = fileURLToPath(new URL(".", moduleUrl));
  return resolve(moduleDir, "..");
}

export function resolveProjectRoot(options: {
  envRoot?: string | undefined;
  cwd?: string;
} = {}): string {
  const envRoot = options.envRoot ?? process.env[PROJECT_ROOT_ENV_VAR];
  const cwd = options.cwd ?? process.cwd();

  if (typeof envRoot === "string" && envRoot.trim()) {
    return resolve(envRoot);
  }

  return cwd;
}

export function resolveProjectPath(projectRoot: string, targetPath: string): string {
  return isAbsolute(targetPath) ? targetPath : resolve(projectRoot, targetPath);
}

/**
 * Resolve `targetPath` relative to `projectRoot` and assert it stays within
 * the root. Throws if the resolved path escapes the project root (e.g. via
 * `../..` or an absolute path pointing outside the root).
 */
export function resolveFileWithinRoot(projectRoot: string, targetPath: string): string {
  const resolvedRoot = resolve(projectRoot);
  const resolvedPath = resolve(projectRoot, targetPath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
    throw new Error(`Path '${targetPath}' escapes project root`);
  }
  return resolvedPath;
}

export const SERVER_REPO_ROOT = resolveServerRepoRoot();
export const PROJECT_ROOT = resolveProjectRoot();
