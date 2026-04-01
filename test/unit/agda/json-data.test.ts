import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { loadJsonData } from "../../../src/json-data.js";

test("loadJsonData reads and validates JSON relative to a module URL", () => {
  const commands = loadJsonData(
    "./src/protocol/data/upstream-agda-commands.json",
    z.array(z.string()),
    pathToFileURL(`${resolve(".")}/`).href,
  );

  expect(commands.includes("Cmd_load")).toBeTruthy();
  expect(commands.includes("Cmd_exit")).toBeTruthy();
});

test("loadJsonData throws on schema mismatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "agda-mcp-json-"));
  const file = join(dir, "bad.json");
  writeFileSync(file, JSON.stringify({ wrong: true }));

  expect(() => {
    loadJsonData(
      "./bad.json",
      z.object({ ok: z.boolean() }),
      pathToFileURL(`${dir}/`).href,
    );
  }).toThrow();
});
