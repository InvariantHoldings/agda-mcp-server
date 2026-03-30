import { isAbsolute, resolve } from "node:path";
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

export const SERVER_REPO_ROOT = resolveServerRepoRoot();
export const PROJECT_ROOT = resolveProjectRoot();
