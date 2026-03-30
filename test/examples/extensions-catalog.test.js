import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TEST_SERVER_REPO_ROOT } from "../helpers/repo-root.js";

const examplesDir = resolve(TEST_SERVER_REPO_ROOT, "examples", "extensions");
const rootReadmePath = resolve(TEST_SERVER_REPO_ROOT, "README.md");
const extensionsDocPath = resolve(TEST_SERVER_REPO_ROOT, "docs", "extensions.md");

const expectedFiles = [
  "README.md",
  "package.json",
  "tsconfig.json",
  "ts-basic-extension.ts",
  "ts-multi-register-extension.ts",
  "ts-goal-snapshot-extension.ts",
  "ts-policy-check-extension.ts",
  "js-basic-extension.js",
];

test("extension examples catalog files exist", () => {
  for (const file of expectedFiles) {
    const target = resolve(examplesDir, file);
    assert.equal(existsSync(target), true, `Missing examples file: ${file}`);
  }
});

test("typescript extension samples export register entry points", () => {
  const tsSamples = [
    "ts-basic-extension.ts",
    "ts-multi-register-extension.ts",
    "ts-goal-snapshot-extension.ts",
    "ts-policy-check-extension.ts",
  ];

  for (const sample of tsSamples) {
    const source = readFileSync(resolve(examplesDir, sample), "utf8");
    assert.match(
      source,
      /export function register|export function register[A-Z]/,
      `No register export found in ${sample}`,
    );
  }
});

test("javascript sample exports register entry point", () => {
  const source = readFileSync(resolve(examplesDir, "js-basic-extension.js"), "utf8");
  assert.match(source, /export function register\(/);
});

test("examples README references all extension sample files", () => {
  const readme = readFileSync(resolve(examplesDir, "README.md"), "utf8");
  const sampleFiles = [
    "ts-basic-extension.ts",
    "ts-multi-register-extension.ts",
    "ts-goal-snapshot-extension.ts",
    "ts-policy-check-extension.ts",
    "js-basic-extension.js",
  ];

  for (const file of sampleFiles) {
    assert.match(readme, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("root README links to extension docs and examples catalog", () => {
  const readme = readFileSync(rootReadmePath, "utf8");
  assert.match(readme, /docs\/extensions\.md/);
  assert.match(readme, /examples\/extensions\/README\.md/);
});

test("extension docs links to examples catalog and workflow section", () => {
  const doc = readFileSync(extensionsDocPath, "utf8");
  assert.match(doc, /examples\/extensions\/README\.md/);
  assert.match(doc, /## Recommended workflow/);
});
