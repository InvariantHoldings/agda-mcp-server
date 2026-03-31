// MIT License — see LICENSE
//
// Runtime package metadata access.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_VERSION = "0.0.0-dev";

export function getServerVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = resolve(here, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };

    return typeof packageJson.version === "string"
      ? packageJson.version
      : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}
