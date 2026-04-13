// MIT License — see LICENSE
//
// Shared session constants (currently: the canonical LoadResult
// returned when a requested file does not exist on disk). Kept in its
// own module so session.ts and any future load-path helpers can
// import without depending on each other.

import type { LoadResult } from "./types.js";

/**
 * Canonical LoadResult for "file not found on disk" — a failed load
 * with empty goals, `type-error` classification, and null profiling.
 * Callers clone the base and overwrite the `errors` field with a
 * tool-specific message ("File not found: /abs/path").
 */
export const NOT_FOUND_RESULT: LoadResult = Object.freeze({
  success: false,
  errors: [],
  warnings: [],
  goals: [],
  allGoalsText: "",
  invisibleGoalCount: 0,
  goalCount: 0,
  hasHoles: false,
  isComplete: false,
  classification: "type-error",
  profiling: null,
});
