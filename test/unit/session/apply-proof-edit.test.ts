import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { applyProofEdit } from "../../../src/session/apply-proof-edit.js";

describe("applyProofEdit", () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agda-edit-test-"));
    tempFile = join(tempDir, "Test.agda");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("replace-hole", () => {
    test("replaces {!!} with expression", async () => {
      await writeFile(tempFile, "test = {!!}");
      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-hole",
        goalId: 0,
        expr: "zero",
      });

      expect(result.applied).toBe(true);
      expect(await readFile(tempFile, "utf-8")).toBe("test = zero");
    });

    test("replaces {! !} with expression", async () => {
      await writeFile(tempFile, "test = {! !}");
      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-hole",
        goalId: 0,
        expr: "zero",
      });

      expect(result.applied).toBe(true);
      expect(await readFile(tempFile, "utf-8")).toBe("test = zero");
    });

    test("replaces {! expr !} with new expression", async () => {
      await writeFile(tempFile, "test = {! old-expr !}");
      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-hole",
        goalId: 0,
        expr: "new-expr",
      });

      expect(result.applied).toBe(true);
      expect(await readFile(tempFile, "utf-8")).toBe("test = new-expr");
    });

    test("replaces ? question-mark hole", async () => {
      await writeFile(tempFile, "test = ?");
      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-hole",
        goalId: 0,
        expr: "refl",
      });

      expect(result.applied).toBe(true);
      expect(await readFile(tempFile, "utf-8")).toBe("test = refl");
    });

    test("replaces correct goal in multi-hole file", async () => {
      const source = "a = {!!}\nb = {!!}\nc = {!!}";
      await writeFile(tempFile, source);
      const result = await applyProofEdit(tempFile, [0, 1, 2], {
        kind: "replace-hole",
        goalId: 1,
        expr: "suc zero",
      });

      expect(result.applied).toBe(true);
      const updated = await readFile(tempFile, "utf-8");
      expect(updated).toBe("a = {!!}\nb = suc zero\nc = {!!}");
    });

    test("handles parenthesized expression", async () => {
      await writeFile(tempFile, "test = {!!}");
      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-hole",
        goalId: 0,
        expr: "(suc zero)",
      });

      expect(result.applied).toBe(true);
      expect(await readFile(tempFile, "utf-8")).toBe("test = (suc zero)");
    });

    test("returns not-applied for unknown goal ID", async () => {
      await writeFile(tempFile, "test = {!!}");
      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-hole",
        goalId: 5,
        expr: "zero",
      });

      expect(result.applied).toBe(false);
      // File should be unchanged
      expect(await readFile(tempFile, "utf-8")).toBe("test = {!!}");
    });

    test("preserves surrounding content", async () => {
      const source = [
        "module Test where",
        "",
        "data Nat : Set where",
        "  zero : Nat",
        "  suc  : Nat → Nat",
        "",
        "test : Nat",
        "test = {!!}",
        "",
        "-- end",
      ].join("\n");
      await writeFile(tempFile, source);

      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-hole",
        goalId: 0,
        expr: "zero",
      });

      expect(result.applied).toBe(true);
      const updated = await readFile(tempFile, "utf-8");
      expect(updated).toContain("test = zero");
      expect(updated).toContain("module Test where");
      expect(updated).toContain("-- end");
    });
  });

  describe("replace-line", () => {
    test("replaces clause line with new clauses", async () => {
      const source = [
        "module Test where",
        "",
        "f : Nat → Nat",
        "f n = {!!}",
      ].join("\n");
      await writeFile(tempFile, source);

      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-line",
        goalId: 0,
        clauses: ["f zero = {!!}", "f (suc n) = {!!}"],
      });

      expect(result.applied).toBe(true);
      const updated = await readFile(tempFile, "utf-8");
      expect(updated).toContain("f zero = {!!}");
      expect(updated).toContain("f (suc n) = {!!}");
      expect(updated).not.toContain("f n = {!!}");
    });

    test("preserves content before and after the replaced line", async () => {
      const source = [
        "module Test where",
        "f n = {!!}",
        "-- end",
      ].join("\n");
      await writeFile(tempFile, source);

      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-line",
        goalId: 0,
        clauses: ["f zero = {!!}", "f (suc n) = {!!}"],
      });

      expect(result.applied).toBe(true);
      const updated = await readFile(tempFile, "utf-8");
      expect(updated).toContain("module Test where");
      expect(updated).toContain("-- end");
    });

    test("returns not-applied for unknown goal ID", async () => {
      await writeFile(tempFile, "f n = {!!}");
      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-line",
        goalId: 5,
        clauses: ["f zero = {!!}"],
      });

      expect(result.applied).toBe(false);
      expect(await readFile(tempFile, "utf-8")).toBe("f n = {!!}");
    });

    test("preserves CRLF line endings", async () => {
      const source = "module Test where\r\nf n = {!!}\r\n-- end";
      await writeFile(tempFile, source);

      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-line",
        goalId: 0,
        clauses: ["f zero = {!!}", "f (suc n) = {!!}"],
      });

      expect(result.applied).toBe(true);
      const updated = await readFile(tempFile, "utf-8");
      expect(updated).toContain("f zero = {!!}\r\nf (suc n) = {!!}");
      expect(updated).toContain("module Test where\r\n");
    });

    test("multi-line hole: replaces from opening line start to closing line end", async () => {
      // Documented behavior: if a hole spans multiple lines, the
      // replace-line branch wipes everything from the start of the
      // line the hole opens on to the end of the line the hole closes
      // on. Agda's Cmd_make_case never hands us a multi-line hole in
      // practice, so this is a defensive test — it pins the current
      // behavior rather than endorsing the multi-line path.
      const source = [
        "module Test where",
        "f n = {! this",
        "          expression",
        "          spans lines !}",
        "-- end",
      ].join("\n");
      await writeFile(tempFile, source);

      const result = await applyProofEdit(tempFile, [0], {
        kind: "replace-line",
        goalId: 0,
        clauses: ["f zero = {!!}", "f (suc n) = {!!}"],
      });

      expect(result.applied).toBe(true);
      const updated = await readFile(tempFile, "utf-8");
      // All three lines the hole occupied are gone.
      expect(updated).not.toContain("f n = {! this");
      expect(updated).not.toContain("expression");
      expect(updated).not.toContain("spans lines !}");
      // The new clauses are present...
      expect(updated).toContain("f zero = {!!}");
      expect(updated).toContain("f (suc n) = {!!}");
      // ...and the surrounding content is preserved.
      expect(updated).toContain("module Test where");
      expect(updated).toContain("-- end");
    });
  });
});
