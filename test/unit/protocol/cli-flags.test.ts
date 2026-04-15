// MIT License — see LICENSE
//
// Tests for --help and --version CLI flags on the built binary.
// These spawn the compiled dist/index.js to verify the flags work end-to-end.

import { test, expect, describe } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DIST_ENTRY = resolve(import.meta.dirname, "../../../dist/index.js");
const distExists = existsSync(DIST_ENTRY);

// All tests in this file require the built artifact.
describe.skipIf(!distExists)("CLI flags (built binary)", () => {
  test("--version exits 0 and prints a semver string", () => {
    const result = spawnSync(process.execPath, [DIST_ENTRY, "--version"], {
      encoding: "utf8",
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    // Should print a semver string like "0.6.5"
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/u);
    expect(result.stderr).toBe("");
  });

  test("-v exits 0 and prints the same version as --version", () => {
    const full = spawnSync(process.execPath, [DIST_ENTRY, "--version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const short = spawnSync(process.execPath, [DIST_ENTRY, "-v"], {
      encoding: "utf8",
      timeout: 5000,
    });

    expect(short.status).toBe(0);
    expect(short.stdout.trim()).toBe(full.stdout.trim());
  });

  test("--help exits 0 and mentions key environment variables", () => {
    const result = spawnSync(process.execPath, [DIST_ENTRY, "--help"], {
      encoding: "utf8",
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    const out = result.stdout;
    expect(out).toContain("agda-mcp-server");
    expect(out).toContain("AGDA_MCP_ROOT");
    expect(out).toContain("AGDA_BIN");
    expect(out).toContain("AGDA_MCP_EXTENSION_MODULES");
    expect(result.stderr).toBe("");
  });

  test("-h exits 0 and produces the same output as --help", () => {
    const full = spawnSync(process.execPath, [DIST_ENTRY, "--help"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const short = spawnSync(process.execPath, [DIST_ENTRY, "-h"], {
      encoding: "utf8",
      timeout: 5000,
    });

    expect(short.status).toBe(0);
    expect(short.stdout).toBe(full.stdout);
  });

  test("--version output matches package.json version", () => {
    const pkg = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../../package.json"),
        "utf8",
      ),
    ) as { version: string };

    const result = spawnSync(process.execPath, [DIST_ENTRY, "--version"], {
      encoding: "utf8",
      timeout: 5000,
    });

    expect(result.stdout.trim()).toBe(pkg.version);
  });
});
