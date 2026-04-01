import { resolve } from "node:path";

import { PROJECT_ROOT_ENV_VAR, SERVER_REPO_ROOT, resolveProjectRoot } from "../../src/repo-root.js";

export const TEST_SERVER_REPO_ROOT: string = SERVER_REPO_ROOT;
export const TEST_FIXTURE_PROJECT_ROOT: string = resolve(TEST_SERVER_REPO_ROOT, "test/fixtures/agda");

export function resolveTestProjectRoot(projectRoot: string = TEST_FIXTURE_PROJECT_ROOT): string {
  return resolveProjectRoot({
    envRoot: process.env[PROJECT_ROOT_ENV_VAR],
    cwd: projectRoot,
  });
}
