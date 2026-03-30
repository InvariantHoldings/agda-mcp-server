import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getServerVersion } from "../dist/server-version.js";

test("runtime server version matches package.json", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
  );

  assert.equal(getServerVersion(), packageJson.version);
});
