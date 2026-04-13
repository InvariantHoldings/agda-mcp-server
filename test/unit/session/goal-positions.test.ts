import { describe, test, expect } from "vitest";

import {
  findGoalPositions,
  findGoalPosition,
} from "../../../src/session/goal-positions.js";

describe("findGoalPositions", () => {
  test("finds empty {!!} hole", () => {
    const source = "test = {!!}";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].markerText).toBe("{!!}");
    expect(positions[0].startOffset).toBe(7);
    expect(positions[0].endOffset).toBe(11);
  });

  test("finds {! !} hole with spaces", () => {
    const source = "test = {! !}";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].markerText).toBe("{! !}");
  });

  test("finds {! expr !} hole with content", () => {
    const source = "test = {! some-expr !}";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].markerText).toBe("{! some-expr !}");
  });

  test("finds ? question-mark hole", () => {
    const source = "test = ?";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].markerText).toBe("?");
    expect(positions[0].startOffset).toBe(7);
    expect(positions[0].endOffset).toBe(8);
  });

  test("finds ? before newline", () => {
    const source = "test = ?\nother = zero";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].markerText).toBe("?");
  });

  test("does not match ? inside identifier", () => {
    const source = "isValid? = true";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(0);
  });

  test("matches ? surrounded by Agda reserved delimiters", () => {
    // ? inside parens
    expect(findGoalPositions("f (?)")).toHaveLength(1);
    // ? inside braces
    expect(findGoalPositions("{?}")).toHaveLength(1);
    // ? preceded by ;
    expect(findGoalPositions(";?")).toHaveLength(1);
    // ? after @
    expect(findGoalPositions("@?")).toHaveLength(1);
  });

  test("does not match ? adjacent to identifier-legal chars", () => {
    // [ ] = : > are legal in Agda identifiers, so ?] etc. is one token
    expect(findGoalPositions("f [?]")).toHaveLength(0);
    expect(findGoalPositions("f ?abc")).toHaveLength(0);
    expect(findGoalPositions("f abc?")).toHaveLength(0);
  });

  test("finds multiple holes in order", () => {
    const source = [
      "module M where",
      "a = {!!}",
      "b = ?",
      "c = {! x !}",
    ].join("\n");
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(3);
    expect(positions[0].markerText).toBe("{!!}");
    expect(positions[1].markerText).toBe("?");
    expect(positions[2].markerText).toBe("{! x !}");
  });

  test("tracks line numbers correctly", () => {
    const source = "line0\nline1 = {!!}\nline2 = ?";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(2);
    expect(positions[0].line).toBe(1);
    expect(positions[1].line).toBe(2);
  });

  test("tracks column numbers correctly", () => {
    const source = "test = {!!}";
    const positions = findGoalPositions(source);
    expect(positions[0].column).toBe(7);
  });

  test("skips holes inside line comments", () => {
    const source = "-- test = {!!}\nreal = {!!}";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].line).toBe(1);
  });

  test("skips holes inside --- triple-dash line comments", () => {
    const source = "--- {!!}\nreal = {!!}";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].line).toBe(1);
  });

  test("skips holes inside block comments", () => {
    const source = "{- {!!} -}\nreal = {!!}";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].line).toBe(1);
  });

  test("skips holes inside nested block comments", () => {
    const source = "{- outer {- inner {!!} -} still comment -}\nreal = ?";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].markerText).toBe("?");
  });

  test("skips holes inside string literals", () => {
    const source = 'test = "{!!}"';
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(0);
  });

  test("handles !} inside string literal within hole", () => {
    const source = 'test = {! "!}" !}';
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].markerText).toBe('{! "!}" !}');
  });

  test("handles !} inside line comment within hole", () => {
    const source = "test = {! -- !}\nreal !}";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].markerText).toBe("{! -- !}\nreal !}");
  });

  test("handles !} inside block comment within hole", () => {
    const source = "test = {! {- !} -} real !}";
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(1);
    expect(positions[0].markerText).toBe("{! {- !} -} real !}");
  });

  test("handles nested {! {! !} !} holes", () => {
    const source = "test = {! {! inner !} !}";
    const positions = findGoalPositions(source);
    // Nested holes count as one outer hole
    expect(positions).toHaveLength(1);
    expect(positions[0].markerText).toBe("{! {! inner !} !}");
  });

  test("handles realistic Agda file", () => {
    const source = [
      "module Test where",
      "",
      "data Nat : Set where",
      "  zero : Nat",
      "  suc  : Nat → Nat",
      "",
      "add : Nat → Nat → Nat",
      "add zero    m = {!!}",
      "add (suc n) m = {!!}",
    ].join("\n");
    const positions = findGoalPositions(source);
    expect(positions).toHaveLength(2);
    expect(positions[0].line).toBe(7);
    expect(positions[1].line).toBe(8);
  });

  test("empty source returns no positions", () => {
    expect(findGoalPositions("")).toEqual([]);
  });

  test("source with no holes returns no positions", () => {
    const source = "module M where\nfoo = zero";
    expect(findGoalPositions(source)).toEqual([]);
  });
});

describe("findGoalPosition", () => {
  test("finds goal by ID using goalIds array", () => {
    const source = "a = {!!}\nb = {!!}\nc = {!!}";
    // goalIds [0, 1, 2] means goal 0 is the first hole, etc.
    const pos = findGoalPosition(source, 1, [0, 1, 2]);
    expect(pos).not.toBeNull();
    expect(pos!.line).toBe(1);
  });

  test("returns null for unknown goal ID", () => {
    const source = "a = {!!}";
    const pos = findGoalPosition(source, 5, [0]);
    expect(pos).toBeNull();
  });

  test("handles non-sequential goal IDs", () => {
    const source = "a = {!!}\nb = {!!}";
    // If goals are numbered [3, 7], goal 7 is the second hole
    const pos = findGoalPosition(source, 7, [3, 7]);
    expect(pos).not.toBeNull();
    expect(pos!.line).toBe(1);
  });

  test("returns null when goalIds is empty", () => {
    const source = "a = {!!}";
    expect(findGoalPosition(source, 0, [])).toBeNull();
  });
});
