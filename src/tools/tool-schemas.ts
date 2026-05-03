// MIT License — see LICENSE
//
// Shared Zod schema fragments for tool input and output fields.
// Centralised so every tool that takes a `goalId` (or any other
// repeating field) uses the same bounds and the same `.describe()`
// language. Drift between tool A's "goalId: z.number()" and tool B's
// "goalId: z.number().int().min(0)" used to be a real risk —
// the bounded schema catches a negative or non-integer at parse time
// (clear MCP error) instead of at the IOTCM layer (opaque Agda crash).

import { z } from "zod";

/**
 * Agda interaction-point IDs are always non-negative integers
 * (assigned by Agda starting at 0 and counting up). Bounding the
 * schema at the input layer means a typo'd negative or fractional
 * ID gets caught with a useful message at JSON-RPC parse time, before
 * it can reach the IOTCM serializer.
 */
export const goalIdSchema = z
  .number()
  .int()
  .min(0)
  .describe("Agda interaction-point ID (non-negative integer, from agda_load output)");

/**
 * Variant for tools where the goal is contextual rather than required
 * (e.g. expression operations that can run at the top level OR in a
 * goal). Same bounds; just optional.
 */
export const optionalGoalIdSchema = goalIdSchema.optional();
