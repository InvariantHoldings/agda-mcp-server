import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getServerVersion } from "../../../src/server-version.js";

test("runtime server version matches package.json", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8"),
  );

  expect(getServerVersion()).toBe(packageJson.version);
});
