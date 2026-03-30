// MIT License — see LICENSE
//
// Advanced Agda interaction queries: constraints, scope, elaboration,
// module contents, search, and combined goal inspection.

import type {
  AgdaCommandContext,
  AgdaResponse,
  WhyInScopeResult,
  ElaborateResult,
  HelperFunctionResult,
  ModuleContentsResult,
  SearchAboutResult,
  AutoResult,
  SolveResult,
  GoalTypeContextInferResult,
  ShowVersionResult,
} from "./types.js";
import {
  lastDisplayMessage,
  firstDisplayMessage,
  firstResponseField,
} from "./response-helpers.js";
import { decodeGoalDisplayResponses } from "../protocol/responses/goal-display.js";
import { decodeSolveResponses } from "../protocol/responses/proof-actions.js";
import {
  command,
  goalCommand,
  modeGoalCommand,
  modeTopLevelCommand,
  quoted,
  topLevelCommand,
} from "../protocol/command-builder.js";

/** Show current constraints. */
export async function constraints(
  ctx: AgdaCommandContext,
): Promise<{ text: string; raw: AgdaResponse[] }> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(ctx.iotcm("Cmd_constraints"));
  return { text: lastDisplayMessage(responses), raw: responses };
}

/** Solve all goals that have unique solutions. */
export async function solveAll(ctx: AgdaCommandContext): Promise<SolveResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(topLevelCommand("Cmd_solveAll", "Normalised")),
  );
  return { solutions: decodeSolveResponses(responses), raw: responses };
}

/** Solve one goal that has a unique solution. */
export async function solveOne(
  ctx: AgdaCommandContext,
  goalId: number,
): Promise<SolveResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_solveOne", "Normalised", goalId, quoted(""))),
  );
  return { solutions: decodeSolveResponses(responses), raw: responses };
}

/** Explain why a name is in scope at a given goal. */
export async function whyInScope(
  ctx: AgdaCommandContext,
  goalId: number,
  name: string,
): Promise<WhyInScopeResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(goalCommand("Cmd_why_in_scope", goalId, quoted(name))),
  );
  return { explanation: lastDisplayMessage(responses), raw: responses };
}

/** Explain why a name is in scope at the top level. */
export async function whyInScopeTopLevel(
  ctx: AgdaCommandContext,
  name: string,
): Promise<WhyInScopeResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(topLevelCommand("Cmd_why_in_scope_toplevel", quoted(name))),
  );
  return { explanation: lastDisplayMessage(responses), raw: responses };
}

/** Elaborate an expression in a goal context. */
export async function elaborate(
  ctx: AgdaCommandContext,
  goalId: number,
  expr: string,
): Promise<ElaborateResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_elaborate_give", "Normalised", goalId, quoted(expr))),
  );
  const elaboration =
    firstResponseField(responses, "GiveAction", "giveResult", "result") ||
    lastDisplayMessage(responses);
  return { elaboration, raw: responses };
}

/** Generate a helper function type for an expression in a goal context. */
export async function helperFunction(
  ctx: AgdaCommandContext,
  goalId: number,
  expr: string,
): Promise<HelperFunctionResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_helper_function", "Normalised", goalId, quoted(expr))),
  );
  return { helperType: lastDisplayMessage(responses), raw: responses };
}

/** Show the contents of a module in a goal context. */
export async function showModuleContents(
  ctx: AgdaCommandContext,
  goalId: number,
  moduleName: string,
): Promise<ModuleContentsResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_show_module_contents", "Normalised", goalId, quoted(moduleName))),
  );
  return { contents: lastDisplayMessage(responses), raw: responses };
}

/** Show the contents of a module at the top level. */
export async function showModuleContentsTopLevel(
  ctx: AgdaCommandContext,
  moduleName: string,
): Promise<ModuleContentsResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeTopLevelCommand("Cmd_show_module_contents_toplevel", "Normalised", quoted(moduleName))),
  );
  return { contents: lastDisplayMessage(responses), raw: responses };
}

/** Search for definitions matching a query string. */
export async function searchAbout(
  ctx: AgdaCommandContext,
  query: string,
): Promise<SearchAboutResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeTopLevelCommand("Cmd_search_about_toplevel", "Normalised", quoted(query))),
  );
  return { results: lastDisplayMessage(responses), raw: responses };
}

/** Auto-solve all goals. */
export async function autoAll(ctx: AgdaCommandContext): Promise<AutoResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(topLevelCommand("Cmd_autoAll", "Normalised")),
  );
  const give = firstResponseField(
    responses,
    "GiveAction",
    "giveResult",
    "result",
  );
  const display = lastDisplayMessage(responses);
  const solution = give && display ? `${give}\n${display}` : give || display;
  return { solution, raw: responses };
}

/** Show the running Agda version. */
export async function showVersion(
  ctx: AgdaCommandContext,
): Promise<ShowVersionResult> {
  const responses = await ctx.sendCommand(ctx.iotcm("Cmd_show_version"));
  const version =
    firstDisplayMessage(responses, ["Version"]) ||
    lastDisplayMessage(responses);
  return { version, raw: responses };
}

/** Get the goal type, context, and inferred type of an expression. */
export async function goalTypeContextInfer(
  ctx: AgdaCommandContext,
  goalId: number,
  expr: string,
): Promise<GoalTypeContextInferResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(modeGoalCommand("Cmd_goal_type_context_infer", "Normalised", goalId, quoted(expr))),
  );
  const decoded = decodeGoalDisplayResponses(responses);
  return {
    goalType: decoded.goalType,
    context: decoded.context,
    inferredType: decoded.auxiliary,
    raw: responses,
  };
}
