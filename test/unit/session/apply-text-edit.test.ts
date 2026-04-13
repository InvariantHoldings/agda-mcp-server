import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { applyTextEdit } from "../../../src/session/apply-proof-edit.js";

describe("applyTextEdit", () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agda-text-edit-test-"));
    tempFile = join(tempDir, "Test.agda");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("replaces a unique match", async () => {
    await writeFile(tempFile, "module Test where\nfoo = zero\n");
    const result = await applyTextEdit(tempFile, "foo", "bar");
    expect(result.applied).toBe(true);
    expect(result.occurrences).toBe(1);
    expect(result.line).toBe(2);
    expect(await readFile(tempFile, "utf-8")).toBe("module Test where\nbar = zero\n");
  });

  test("fails when oldText is not found", async () => {
    await writeFile(tempFile, "module Test where\n");
    const result = await applyTextEdit(tempFile, "foo", "bar");
    expect(result.applied).toBe(false);
    expect(result.occurrences).toBe(0);
    expect(result.message).toContain("not found");
    expect(await readFile(tempFile, "utf-8")).toBe("module Test where\n");
  });

  test("fails on ambiguous match without occurrence", async () => {
    await writeFile(tempFile, "foo\nfoo\nfoo\n");
    const result = await applyTextEdit(tempFile, "foo", "bar");
    expect(result.applied).toBe(false);
    expect(result.occurrences).toBe(3);
    expect(result.message).toContain("3 locations");
    expect(await readFile(tempFile, "utf-8")).toBe("foo\nfoo\nfoo\n");
  });

  test("targets specific occurrence when specified", async () => {
    await writeFile(tempFile, "foo\nfoo\nfoo\n");
    const result = await applyTextEdit(tempFile, "foo", "bar", { occurrence: 2 });
    expect(result.applied).toBe(true);
    expect(result.line).toBe(2);
    expect(await readFile(tempFile, "utf-8")).toBe("foo\nbar\nfoo\n");
  });

  test("rejects out-of-range occurrence", async () => {
    await writeFile(tempFile, "foo\nfoo\n");
    const result = await applyTextEdit(tempFile, "foo", "bar", { occurrence: 5 });
    expect(result.applied).toBe(false);
    expect(result.occurrences).toBe(2);
    expect(result.message).toContain("only 2");
    expect(await readFile(tempFile, "utf-8")).toBe("foo\nfoo\n");
  });

  test("rejects empty oldText", async () => {
    await writeFile(tempFile, "module Test where\n");
    const result = await applyTextEdit(tempFile, "", "bar");
    expect(result.applied).toBe(false);
    expect(result.message).toContain("must not be empty");
  });

  test("handles multiline oldText", async () => {
    await writeFile(tempFile, "line1\nline2\nline3\n");
    const result = await applyTextEdit(tempFile, "line1\nline2", "replaced");
    expect(result.applied).toBe(true);
    expect(result.line).toBe(1);
    expect(await readFile(tempFile, "utf-8")).toBe("replaced\nline3\n");
  });

  test("can insert text by matching a unique anchor", async () => {
    await writeFile(
      tempFile,
      "module Test where\n\nfoo : Nat\nfoo = zero\n",
    );
    const result = await applyTextEdit(
      tempFile,
      "module Test where",
      "module Test where\n\nopen import Data.Nat",
    );
    expect(result.applied).toBe(true);
    const content = await readFile(tempFile, "utf-8");
    expect(content).toBe(
      "module Test where\n\nopen import Data.Nat\n\nfoo : Nat\nfoo = zero\n",
    );
  });

  test("reports correct line number for edits deep in file", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line${i}`);
    lines[30] = "target";
    await writeFile(tempFile, lines.join("\n"));
    const result = await applyTextEdit(tempFile, "target", "replaced");
    expect(result.applied).toBe(true);
    expect(result.line).toBe(31); // 1-based
  });

  test("preserves CRLF line endings", async () => {
    await writeFile(tempFile, "foo\r\nbar\r\nbaz\r\n");
    const result = await applyTextEdit(tempFile, "bar", "qux");
    expect(result.applied).toBe(true);
    expect(await readFile(tempFile, "utf-8")).toBe("foo\r\nqux\r\nbaz\r\n");
  });

  describe("line ending normalization", () => {
    test("LF oldText matches CRLF file (multi-line)", async () => {
      // LLMs generate \n-delimited oldText even for CRLF files.
      // Without normalization, indexOf would return -1.
      await writeFile(tempFile, "line1\r\nline2\r\nline3\r\n");
      const result = await applyTextEdit(tempFile, "line1\nline2", "replaced");
      expect(result.applied).toBe(true);
      expect(await readFile(tempFile, "utf-8")).toBe("replaced\r\nline3\r\n");
    });

    test("LF newText is promoted to CRLF when file is CRLF", async () => {
      // Multi-line newText from an LLM should not introduce mixed endings.
      await writeFile(tempFile, "foo\r\nanchor\r\nbaz\r\n");
      const result = await applyTextEdit(
        tempFile,
        "anchor",
        "first\nsecond\nthird",
      );
      expect(result.applied).toBe(true);
      const content = await readFile(tempFile, "utf-8");
      expect(content).toBe("foo\r\nfirst\r\nsecond\r\nthird\r\nbaz\r\n");
      expect(content).not.toMatch(/(?<!\r)\n/); // no bare LF anywhere
    });

    test("CRLF oldText still matches CRLF file (pre-normalized inputs pass through)", async () => {
      // An agent that already happens to use \r\n should still work.
      await writeFile(tempFile, "line1\r\nline2\r\nline3\r\n");
      const result = await applyTextEdit(tempFile, "line1\r\nline2", "replaced");
      expect(result.applied).toBe(true);
      expect(await readFile(tempFile, "utf-8")).toBe("replaced\r\nline3\r\n");
    });

    test("LF file with LF oldText is untouched by normalization", async () => {
      await writeFile(tempFile, "line1\nline2\nline3\n");
      const result = await applyTextEdit(tempFile, "line2", "replaced");
      expect(result.applied).toBe(true);
      expect(await readFile(tempFile, "utf-8")).toBe("line1\nreplaced\nline3\n");
    });
  });

  describe("file I/O error handling (no exceptions)", () => {
    test("returns structured failure when file does not exist", async () => {
      // Path that definitely doesn't exist. applyTextEdit should not
      // throw — it should return {applied: false} with an ENOENT
      // message so the agent gets a usable response.
      const missing = join(tempDir, "DoesNotExist.agda");
      const result = await applyTextEdit(missing, "foo", "bar");
      expect(result.applied).toBe(false);
      expect(result.occurrences).toBe(0);
      expect(result.line).toBeNull();
      expect(result.message).toContain("ENOENT");
    });

    test("returns structured failure when path is a directory", async () => {
      // Caller passes a directory — readFile rejects with EISDIR.
      // We should surface that cleanly, not throw.
      const result = await applyTextEdit(tempDir, "foo", "bar");
      expect(result.applied).toBe(false);
      expect(result.occurrences).toBe(0);
      expect(result.message).toContain("EISDIR");
    });
  });

  test("leaves no temp file after a successful write (atomic rename)", async () => {
    await writeFile(tempFile, "foo bar baz");
    const result = await applyTextEdit(tempFile, "bar", "qux");
    expect(result.applied).toBe(true);

    // Verify no stray .agda-mcp-tmp-* files are left behind in the dir
    const entries = await readdir(tempDir);
    const leaked = entries.filter((name) => name.includes("agda-mcp-tmp-"));
    expect(leaked).toEqual([]);
  });

  describe("security hardening", () => {
    test("rejects NUL byte in oldText", async () => {
      await writeFile(tempFile, "foo bar baz");
      const result = await applyTextEdit(tempFile, "foo\u0000", "bar");
      expect(result.applied).toBe(false);
      expect(result.message).toContain("NUL");
      // File must not have been touched.
      expect(await readFile(tempFile, "utf-8")).toBe("foo bar baz");
    });

    test("rejects NUL byte in newText", async () => {
      await writeFile(tempFile, "foo bar baz");
      const result = await applyTextEdit(tempFile, "foo", "bar\u0000baz");
      expect(result.applied).toBe(false);
      expect(result.message).toContain("NUL");
      expect(await readFile(tempFile, "utf-8")).toBe("foo bar baz");
    });

    test("accepts normal UTF-8 that happens to look suspicious", async () => {
      // Unicode chars like U+00A0 NBSP or astral mathematical symbols
      // are legal Agda identifier/source content and must pass.
      await writeFile(tempFile, "foo 𝟘 baz");
      const result = await applyTextEdit(tempFile, "𝟘", "zero");
      expect(result.applied).toBe(true);
      expect(await readFile(tempFile, "utf-8")).toBe("foo zero baz");
    });
  });
});
