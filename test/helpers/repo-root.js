import { resolve } from "node:path";

import { PROJECT_ROOT_ENV_VAR, SERVER_REPO_ROOT, resolveProjectRoot } from "../../dist/repo-root.js";

export const TEST_SERVER_REPO_ROOT = SERVER_REPO_ROOT;
export const TEST_FIXTURE_PROJECT_ROOT = resolve(TEST_SERVER_REPO_ROOT, "test/fixtures/agda");

export function resolveTestProjectRoot(projectRoot = TEST_FIXTURE_PROJECT_ROOT) {
  return resolveProjectRoot({
    envRoot: process.env[PROJECT_ROOT_ENV_VAR],
    cwd: projectRoot,
  });
}
