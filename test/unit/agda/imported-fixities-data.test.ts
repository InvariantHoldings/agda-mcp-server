// MIT License — see LICENSE
//
// Pin the JSON-backed `imported-fixities.json` invariants so the
// fixity-conflict detector can't silently lose its reference set.

import { test, expect } from "vitest";

import { inferFixityConflicts } from "../../../src/agda/clause-fixity.js";

test("default imported fixities still cover the canonical stdlib operators", () => {
  // A user-defined `_⊕_` operator on the same line as `_+_` should
  // produce a conflict warning under the default reference map. This
  // pins that the JSON loaded a non-empty `_+_` precedence (which is
  // the most common stdlib operator and the most useful one to keep
  // the warning calibrated against).
  const source = [
    "module Test where",
    "_⊕_ : ℕ → ℕ → ℕ",
    "x ⊕ y = x + y",
  ].join("\n");

  const conflicts = inferFixityConflicts(source);
  // At least one conflict should reference _+_ (the curated operator
  // we know is in the JSON map). If not, the JSON either failed to
  // load or dropped the entry.
  expect(conflicts.some((c) => c.conflictingOperator === "_+_")).toBe(true);
});

test("fixity conflict carries the precedence loaded from JSON", () => {
  const source = [
    "module Test where",
    "_⊕_ : ℕ → ℕ → ℕ",
    "x ⊕ y = x + y",
  ].join("\n");
  const conflict = inferFixityConflicts(source).find(
    (c) => c.conflictingOperator === "_+_",
  );
  expect(conflict).toBeDefined();
  // _+_ precedence in the JSON is 6; suggested fixity wraps that.
  expect(conflict!.conflictingPrecedence).toBe(6);
  expect(conflict!.suggestedFixity).toBe("infix 6 _⊕_");
});
