import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { loadJsonData } from "../../../dist/json-data.js";

test("loadJsonData reads and validates JSON relative to a module URL", () => {
  const commands = loadJsonData(
    "./src/protocol/data/upstream-agda-commands.json",
    z.array(z.string()),
    pathToFileURL(`${resolve(".")}/`).href,
  );

  assert.ok(commands.includes("Cmd_load"));
  assert.ok(commands.includes("Cmd_exit"));
});

test("loadJsonData throws on schema mismatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "agda-mcp-json-"));
  const file = join(dir, "bad.json");
  writeFileSync(file, JSON.stringify({ wrong: true }));

  assert.throws(() => {
    loadJsonData(
      "./bad.json",
      z.object({ ok: z.boolean() }),
      pathToFileURL(`${dir}/`).href,
    );
  });
});
