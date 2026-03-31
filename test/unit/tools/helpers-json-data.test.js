import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { loadValidatedJsonData } from "../../helpers/json-data.js";

test("loadValidatedJsonData resolves relative to moduleDir and validates with zod", () => {
  const dir = mkdtempSync(join(tmpdir(), "agda-mcp-test-json-"));
  const file = join(dir, "fixture.json");
  writeFileSync(file, JSON.stringify([{ name: "example" }]));

  const data = loadValidatedJsonData(
    dir,
    "./fixture.json",
    z.array(z.object({ name: z.string().min(1) })),
  );

  assert.deepEqual(data, [{ name: "example" }]);
});

test("loadValidatedJsonData throws when the schema does not match", () => {
  const dir = mkdtempSync(join(tmpdir(), "agda-mcp-test-json-"));
  const file = join(dir, "fixture.json");
  writeFileSync(file, JSON.stringify([{ name: 1 }]));

  assert.throws(() => {
    loadValidatedJsonData(
      dir,
      "./fixture.json",
      z.array(z.object({ name: z.string().min(1) })),
    );
  });
});
