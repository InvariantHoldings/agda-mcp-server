// MIT License — see LICENSE
//
// Expression-level Agda commands: compute (normalize) and infer (type-check).

import type {
  AgdaCommandContext,
  ComputeResult,
  InferResult,
} from "./types.js";
import { escapeAgdaString } from "./response-parsing.js";
import { firstDisplayMessage, lastDisplayMessage } from "./response-helpers.js";

/**
 * Normalize (evaluate) a term in a goal context.
 */
export async function compute(
  ctx: AgdaCommandContext,
  goalId: number,
  expr: string,
): Promise<ComputeResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(`Cmd_compute DefaultCompute ${goalId} noRange "${escapeAgdaString(expr)}"`),
  );
  const normalForm =
    firstDisplayMessage(responses, ["NormalForm", "GoalSpecific"]) ||
    lastDisplayMessage(responses);
  return { normalForm, raw: responses };
}

/**
 * Normalize a top-level expression (not in a goal context).
 */
export async function computeTopLevel(
  ctx: AgdaCommandContext,
  expr: string,
): Promise<ComputeResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(`Cmd_compute_toplevel DefaultCompute "${escapeAgdaString(expr)}"`),
  );
  return { normalForm: lastDisplayMessage(responses), raw: responses };
}

/**
 * Infer the type of an expression in a goal context.
 */
export async function infer(
  ctx: AgdaCommandContext,
  goalId: number,
  expr: string,
): Promise<InferResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(`Cmd_infer Normalised ${goalId} noRange "${escapeAgdaString(expr)}"`),
  );
  const type =
    firstDisplayMessage(responses, ["InferredType", "GoalSpecific"]) ||
    lastDisplayMessage(responses);
  return { type, raw: responses };
}

/**
 * Infer the type of a top-level expression.
 */
export async function inferTopLevel(
  ctx: AgdaCommandContext,
  expr: string,
): Promise<InferResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(`Cmd_infer_toplevel Normalised "${escapeAgdaString(expr)}"`),
  );
  return { type: lastDisplayMessage(responses), raw: responses };
}
