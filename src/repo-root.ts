import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT_ENV_VAR = "AGDA_MCP_ROOT";

type RelativePathApi = {
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
  sep?: string;
};

function nativeRealpath(path: string): string {
  return typeof realpathSync.native === "function"
    ? realpathSync.native(path)
    : realpathSync(path);
}

export class PathSandboxError extends Error {
  readonly targetPath: string;

  constructor(targetPath: string, message: string) {
    super(message);
    this.name = "PathSandboxError";
    this.targetPath = targetPath;
  }
}

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

export function isPathWithinRoot(
  rootPath: string,
  targetPath: string,
  pathApi: RelativePathApi = { relative, isAbsolute, sep },
): boolean {
  const relPath = pathApi.relative(rootPath, targetPath);
  const startsWithParentSegment = relPath === ".."
    || relPath.startsWith(`..${pathApi.sep ?? sep}`);

  return relPath === "" || (!startsWithParentSegment && !pathApi.isAbsolute(relPath));
}

/**
 * Resolve `targetPath` relative to `projectRoot` and assert it stays within
 * the root. Throws if the resolved path escapes the project root (e.g. via
 * `../..` or an absolute path pointing outside the root).
 */
export function resolveFileWithinRoot(projectRoot: string, targetPath: string): string {
  const resolvedRoot = resolve(projectRoot);
  const resolvedPath = resolve(projectRoot, targetPath);
  if (!isPathWithinRoot(resolvedRoot, resolvedPath)) {
    throw new PathSandboxError(targetPath, `Path '${targetPath}' escapes project root`);
  }
  return resolvedPath;
}

/**
 * Resolve an existing filesystem target and assert that its canonical path
 * remains within the project root after following symlinks.
 */
export function resolveExistingPathWithinRoot(projectRoot: string, targetPath: string): string {
  const resolvedPath = resolveFileWithinRoot(projectRoot, targetPath);
  const canonicalRoot = nativeRealpath(resolve(projectRoot));
  const canonicalPath = nativeRealpath(resolvedPath);

  if (!isPathWithinRoot(canonicalRoot, canonicalPath)) {
    throw new PathSandboxError(
      targetPath,
      `Path '${targetPath}' resolves outside project root`,
    );
  }

  return canonicalPath;
}

export const SERVER_REPO_ROOT = resolveServerRepoRoot();
export const PROJECT_ROOT = resolveProjectRoot();
