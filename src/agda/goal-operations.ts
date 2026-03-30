// MIT License — see LICENSE
//
// Goal-oriented Agda interaction commands.

import type {
  AgdaCommandContext,
  AgdaResponse,
  AgdaGoal,
  GoalInfo,
  GoalTypeResult,
  ContextResult,
  GoalTypeContextCheckResult,
  CaseSplitResult,
  GiveResult,
  AutoResult,
} from "./types.js";
import { decodeGoalDisplayResponses } from "../protocol/responses/goal-display.js";
import {
  decodeCaseSplitResponses,
  decodeGiveLikeResponse,
} from "../protocol/responses/proof-actions.js";
import { decodeDisplayInfoEvents } from "../protocol/responses/display-info.js";
import { decodeLoadDisplayResponses } from "../protocol/responses/load-display.js";
import { decodeGoalExpressionDisplayResponses } from "../protocol/responses/goal-expression-display.js";
import { goalCommand, modeGoalCommand, quoted } from "../protocol/command-builder.js";

/** Get the type and local context for a specific goal. */
export async function goalTypeContext(
  ctx: AgdaCommandContext,
  goalId: number,
): Promise<GoalInfo> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_goal_type_context", "Normalised", goalId, quoted(""))),
  );
  const decoded = decodeGoalDisplayResponses(responses);
  return { goalId, type: decoded.goalType, context: decoded.context, raw: responses };
}

/** Get only the current goal type for a specific goal. */
export async function goalType(
  ctx: AgdaCommandContext,
  goalId: number,
): Promise<GoalTypeResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_goal_type", "Normalised", goalId, quoted(""))),
  );
  const decoded = decodeGoalDisplayResponses(responses);
  return { goalId, type: decoded.goalType, raw: responses };
}

/** Get only the local context for a specific goal. */
export async function context(
  ctx: AgdaCommandContext,
  goalId: number,
): Promise<ContextResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_context", "Normalised", goalId, quoted(""))),
  );
  const decoded = decodeGoalDisplayResponses(responses);
  return { goalId, context: decoded.context, raw: responses };
}

/** Get goal, context, and checked elaborated term for an expression in a goal. */
export async function goalTypeContextCheck(
  ctx: AgdaCommandContext,
  goalId: number,
  expr: string,
): Promise<GoalTypeContextCheckResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_goal_type_context_check", "Normalised", goalId, quoted(expr))),
  );
  const decoded = decodeGoalExpressionDisplayResponses(responses);
  return {
    goalType: decoded.goalType,
    context: decoded.context,
    checkedExpr: decoded.checkedExpr,
    raw: responses,
  };
}

/** Case-split on a variable in a goal. */
export async function caseSplit(
  ctx: AgdaCommandContext,
  goalId: number,
  variable: string,
): Promise<CaseSplitResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(goalCommand("Cmd_make_case", goalId, quoted(variable))),
  );
  return { clauses: decodeCaseSplitResponses(responses), raw: responses };
}

/** Give (fill) a goal with an expression. */
export async function give(
  ctx: AgdaCommandContext,
  goalId: number,
  expr: string,
): Promise<GiveResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_give", "WithoutForce", goalId, quoted(expr))),
  );
  return { result: decodeGiveLikeResponse(responses), raw: responses };
}

/** Refine a goal — apply a function and create subgoals. */
export async function refine(
  ctx: AgdaCommandContext,
  goalId: number,
  expr: string,
): Promise<GiveResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_refine_or_intro", "True", goalId, quoted(expr))),
  );
  return { result: decodeGiveLikeResponse(responses), raw: responses };
}

/** Refine a goal using Agda's exact Cmd_refine command. */
export async function refineExact(
  ctx: AgdaCommandContext,
  goalId: number,
  expr: string,
): Promise<GiveResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(goalCommand("Cmd_refine", goalId, quoted(expr))),
  );
  return { result: decodeGiveLikeResponse(responses), raw: responses };
}

/** Introduce a lambda or constructor using Agda's exact Cmd_intro command. */
export async function intro(
  ctx: AgdaCommandContext,
  goalId: number,
  expr = "",
): Promise<GiveResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_intro", "True", goalId, quoted(expr))),
  );
  return { result: decodeGiveLikeResponse(responses), raw: responses };
}

/** Auto-solve a single goal. */
export async function autoOne(
  ctx: AgdaCommandContext,
  goalId: number,
): Promise<AutoResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(goalCommand("Cmd_autoOne", goalId, quoted(""))),
  );
  return { solution: decodeGiveLikeResponse(responses), raw: responses };
}

/** List all unsolved metavariables (goals). */
export async function metas(
  ctx: AgdaCommandContext,
): Promise<{ goals: AgdaGoal[]; text: string; raw: AgdaResponse[] }> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(ctx.iotcm("Cmd_metas"));

  const text = decodeDisplayInfoEvents(responses)
    .map((event) => event.text)
    .filter(Boolean)
    .at(-1) ?? "";
  const goals = decodeLoadDisplayResponses(responses).visibleGoals.map((goal) => ({
    goalId: goal.goalId,
    type: goal.type,
    context: [] as string[],
  }));

  // Fall back to cached goalIds if Cmd_metas didn't return structured goals
  if (goals.length === 0 && ctx.goalIds.length > 0) {
    goals.push(...ctx.goalIds.map((id) => ({ goalId: id, type: "?", context: [] as string[] })));
  }

  return { goals, text, raw: responses };
}
