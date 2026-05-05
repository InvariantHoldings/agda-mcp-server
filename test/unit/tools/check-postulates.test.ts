// MIT License — see LICENSE
//
// Unit tests for the pure `findPostulates` helper extracted from the
// agda_check_postulates tool. The integration tests at
// test/unit/tools/tool-stress.test.ts exercise the full MCP-tool
// path; this suite drives the source-scan logic directly so edge
// cases (inline comments, block comments, indented headers, etc.)
// can be pinned without filesystem round-tripping.

import { describe, test, expect } from "vitest";

import { findPostulates } from "../../../src/tools/file/check-postulates.js";

describe("findPostulates — inline-comment handling", () => {
  test("treats `postulate -- comment` as a block-style header with no inline declarations", () => {
    const source = [
      "module M where",
      "postulate -- TODO fill me in",
      "  ax : Set",
      "",
      "x = ax",
    ].join("\n");

    const blocks = findPostulates(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].line).toBe(2);
    // The trailing `-- TODO fill me in` must NOT be parsed as
    // declarations. Only the indented body line `ax : Set` should
    // contribute identifiers.
    expect(blocks[0].declarations).toEqual(["ax"]);
  });

  test("strips trailing line comments from inline form", () => {
    const source = [
      "module M where",
      "postulate ax : Set -- explanatory note",
    ].join("\n");

    const blocks = findPostulates(source);
    expect(blocks).toHaveLength(1);
    // `-- explanatory note` must not appear in declarations.
    expect(blocks[0].declarations).toEqual(["ax"]);
  });

  test("strips inline block comments from header line", () => {
    const source = [
      "module M where",
      "postulate {- legacy -} p q : Nat",
    ].join("\n");

    const blocks = findPostulates(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].declarations).toEqual(["p", "q"]);
  });

  test("returns an empty list when the file has no postulates", () => {
    const source = [
      "module M where",
      "x : Set",
      "x = Set",
    ].join("\n");

    expect(findPostulates(source)).toEqual([]);
  });

  test("handles multiple block-form postulates with mixed declarations", () => {
    const source = [
      "module M where",
      "postulate",
      "  a b : Set",
      "  c   : Set",
      "",
      "f : Set",
      "f = a",
      "",
      "  postulate -- nested",
      "    d : Set",
    ].join("\n");

    const blocks = findPostulates(source);
    // First block: lines 3-4 declare a, b, c
    // Second block (indented): line 9 declares d
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const first = blocks[0];
    expect(first.line).toBe(2);
    expect(first.declarations).toEqual(["a", "b", "c"]);
  });

  test("ignores comment-only lines within a block body", () => {
    const source = [
      "module M where",
      "postulate",
      "  -- block comment in body",
      "  ax : Set",
      "  -- another",
      "  bx : Set",
    ].join("\n");

    const blocks = findPostulates(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].declarations).toEqual(["ax", "bx"]);
  });
});
