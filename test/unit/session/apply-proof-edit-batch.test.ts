import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { applyBatchHoleReplacements } from "../../../src/session/apply-proof-edit.js";

describe("applyBatchHoleReplacements", () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agda-batch-edit-test-"));
    tempFile = join(tempDir, "Test.agda");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("applies a single replacement correctly", async () => {
    await writeFile(tempFile, "test = {!!}");
    const result = await applyBatchHoleReplacements(tempFile, [0], [{ goalId: 0, expr: "refl" }]);

    expect(result.appliedCount).toBe(1);
    expect(result.failedGoalIds).toEqual([]);
    expect(await readFile(tempFile, "utf-8")).toBe("test = refl");
  });

  test("applies multiple replacements back-to-front, yielding correct final source", async () => {
    await writeFile(tempFile, "a = {!!}\nb = {!!}");
    // goal IDs are [0, 1] in file order
    const result = await applyBatchHoleReplacements(tempFile, [0, 1], [
      { goalId: 0, expr: "zero" },
      { goalId: 1, expr: "suc zero" },
    ]);

    expect(result.appliedCount).toBe(2);
    expect(result.failedGoalIds).toEqual([]);
    expect(await readFile(tempFile, "utf-8")).toBe("a = zero\nb = suc zero");
  });

  test("returns failedGoalIds for unknown goals", async () => {
    await writeFile(tempFile, "test = {!!}");
    const result = await applyBatchHoleReplacements(tempFile, [0], [
      { goalId: 0, expr: "refl" },
      { goalId: 5, expr: "tt" },
    ]);

    expect(result.appliedCount).toBe(1);
    expect(result.failedGoalIds).toEqual([5]);
    expect(await readFile(tempFile, "utf-8")).toBe("test = refl");
  });

  test("returns appliedCount 0 with message when all goals missing", async () => {
    await writeFile(tempFile, "test = {!!}");
    const result = await applyBatchHoleReplacements(tempFile, [0], [
      { goalId: 99, expr: "refl" },
    ]);

    expect(result.appliedCount).toBe(0);
    expect(result.failedGoalIds).toEqual([99]);
    expect(result.message).toContain("?99");
    // File should be unchanged
    expect(await readFile(tempFile, "utf-8")).toBe("test = {!!}");
  });

  test("handles empty replacements array", async () => {
    await writeFile(tempFile, "test = {!!}");
    const result = await applyBatchHoleReplacements(tempFile, [0], []);

    expect(result.appliedCount).toBe(0);
    expect(result.failedGoalIds).toEqual([]);
    expect(result.message).toBe("No replacements to apply.");
    // File unchanged
    expect(await readFile(tempFile, "utf-8")).toBe("test = {!!}");
  });

  test("CRLF files are preserved", async () => {
    await writeFile(tempFile, "test = {!!}\r\nother = {!!}");
    const result = await applyBatchHoleReplacements(tempFile, [0, 1], [
      { goalId: 0, expr: "zero" },
    ]);

    expect(result.appliedCount).toBe(1);
    const content = await readFile(tempFile, "utf-8");
    expect(content).toBe("test = zero\r\nother = {!!}");
  });

  test("applies three replacements to correct positions", async () => {
    await writeFile(tempFile, "a = {!!}\nb = {!!}\nc = {!!}");
    const result = await applyBatchHoleReplacements(tempFile, [10, 11, 12], [
      { goalId: 10, expr: "one" },
      { goalId: 11, expr: "two" },
      { goalId: 12, expr: "three" },
    ]);

    expect(result.appliedCount).toBe(3);
    expect(result.failedGoalIds).toEqual([]);
    expect(await readFile(tempFile, "utf-8")).toBe("a = one\nb = two\nc = three");
  });

  test("partial success: applies found goals and reports missing ones", async () => {
    await writeFile(tempFile, "a = {!!}\nb = {!!}");
    const result = await applyBatchHoleReplacements(tempFile, [0, 1], [
      { goalId: 0, expr: "refl" },
      { goalId: 7, expr: "tt" },
      { goalId: 1, expr: "zero" },
    ]);

    expect(result.appliedCount).toBe(2);
    expect(result.failedGoalIds).toEqual([7]);
    expect(result.message).toContain("2 solution(s)");
    expect(result.message).toContain("?7");
    expect(await readFile(tempFile, "utf-8")).toBe("a = refl\nb = zero");
  });

  test("deduplicates: first replacement wins when same goalId appears twice", async () => {
    await writeFile(tempFile, "test = {!!}");
    const result = await applyBatchHoleReplacements(tempFile, [0], [
      { goalId: 0, expr: "first" },
      { goalId: 0, expr: "second" },
    ]);

    expect(result.appliedCount).toBe(1);
    expect(result.failedGoalIds).toEqual([]);
    expect(await readFile(tempFile, "utf-8")).toBe("test = first");
  });
});
