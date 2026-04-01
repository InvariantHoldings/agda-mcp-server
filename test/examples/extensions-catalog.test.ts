import { test, expect } from "vitest";
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
    expect(existsSync(target)).toBe(true);
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
    expect(source).toMatch(
      /export function register|export function register[A-Z]/,
    );
  }
});

test("javascript sample exports register entry point", () => {
  const source = readFileSync(resolve(examplesDir, "js-basic-extension.js"), "utf8");
  expect(source).toMatch(/export function register\(/);
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
    expect(readme).toMatch(new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("root README links to extension docs and examples catalog", () => {
  const readme = readFileSync(rootReadmePath, "utf8");
  expect(readme).toMatch(/docs\/extensions\.md/);
  expect(readme).toMatch(/examples\/extensions\/README\.md/);
});

test("extension docs links to examples catalog and workflow section", () => {
  const doc = readFileSync(extensionsDocPath, "utf8");
  expect(doc).toMatch(/examples\/extensions\/README\.md/);
  expect(doc).toMatch(/## Recommended workflow/);
});
