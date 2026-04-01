import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import { loadValidatedJsonData } from "../../../tooling/protocol/json-data.js";

test("loadValidatedJsonData resolves module URLs with encoded filesystem paths", () => {
  const root = mkdtempSync(join(tmpdir(), "agda mcp json-data "));
  const moduleDir = join(root, "with spaces");
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(moduleDir, "value.json"), JSON.stringify({ ok: true }), "utf8");

  const loaded = loadValidatedJsonData(
    "./value.json",
    z.object({ ok: z.boolean() }),
    pathToFileURL(join(moduleDir, "module.mjs")).href,
  );

  expect(loaded).toEqual({ ok: true });
});
