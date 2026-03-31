import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { copyJsonAssets } from "../../../scripts/copy-json-assets.mjs";

test("copyJsonAssets copies nested json files and ignores non-json files", () => {
  const root = mkdtempSync(join(tmpdir(), "agda-mcp-copy-json-"));
  const sourceRoot = join(root, "src");
  const destRoot = join(root, "dist");

  mkdirSync(join(sourceRoot, "protocol", "data"), { recursive: true });
  mkdirSync(join(sourceRoot, "tools"), { recursive: true });

  writeFileSync(join(sourceRoot, "protocol", "data", "parity.json"), "{\"ok\":true}\n", "utf8");
  writeFileSync(join(sourceRoot, "tools", "ignored.txt"), "nope\n", "utf8");

  copyJsonAssets(sourceRoot, destRoot);

  const copiedFile = join(destRoot, "protocol", "data", "parity.json");
  assert.equal(existsSync(copiedFile), true);
  assert.equal(readFileSync(copiedFile, "utf8"), "{\"ok\":true}\n");
  assert.equal(existsSync(join(destRoot, "tools", "ignored.txt")), false);
});
