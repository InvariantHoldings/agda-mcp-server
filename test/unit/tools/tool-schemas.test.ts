// MIT License — see LICENSE
//
// Pin the bounds on the shared `goalIdSchema` so a future edit can't
// silently widen them. A negative or fractional goalId reaching the
// IOTCM serializer used to surface as an opaque Agda crash; the
// schema now catches those at JSON-RPC parse time with a clear error.

import { test, expect } from "vitest";

import {
  goalIdSchema,
  optionalGoalIdSchema,
} from "../../../src/tools/tool-schemas.js";

test("goalIdSchema accepts non-negative integers", () => {
  expect(goalIdSchema.safeParse(0).success).toBe(true);
  expect(goalIdSchema.safeParse(1).success).toBe(true);
  expect(goalIdSchema.safeParse(42).success).toBe(true);
  expect(goalIdSchema.safeParse(1_000_000).success).toBe(true);
});

test("goalIdSchema rejects negative integers", () => {
  const r = goalIdSchema.safeParse(-1);
  expect(r.success).toBe(false);
});

test("goalIdSchema rejects fractional values", () => {
  expect(goalIdSchema.safeParse(0.5).success).toBe(false);
  expect(goalIdSchema.safeParse(3.14).success).toBe(false);
});

test("goalIdSchema rejects NaN and Infinity", () => {
  expect(goalIdSchema.safeParse(Number.NaN).success).toBe(false);
  expect(goalIdSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  expect(goalIdSchema.safeParse(Number.NEGATIVE_INFINITY).success).toBe(false);
});

test("goalIdSchema rejects string and other non-number types", () => {
  expect(goalIdSchema.safeParse("0").success).toBe(false);
  expect(goalIdSchema.safeParse(null).success).toBe(false);
  expect(goalIdSchema.safeParse(undefined).success).toBe(false);
});

test("optionalGoalIdSchema accepts undefined", () => {
  expect(optionalGoalIdSchema.safeParse(undefined).success).toBe(true);
});

test("optionalGoalIdSchema applies the same bounds when present", () => {
  expect(optionalGoalIdSchema.safeParse(0).success).toBe(true);
  expect(optionalGoalIdSchema.safeParse(-1).success).toBe(false);
  expect(optionalGoalIdSchema.safeParse(0.5).success).toBe(false);
});
