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
import { decodeGoalDisplayResponses } from "../protocol/responses/goal-display.js";
import { decodeGiveLikeResponse, decodeSolveResponses } from "../protocol/responses/proof-actions.js";
import { decodeSearchAboutResponses } from "../protocol/responses/search-about.js";
import { decodeGoalExpressionDisplayResponses } from "../protocol/responses/goal-expression-display.js";
import { decodeDisplayTextResponses } from "../protocol/responses/text-display.js";
import {
  command,
  goalCommand,
  modeGoalCommand,
  modeTopLevelCommand,
  quoted,
  rewriteGoalCommand,
  rewriteTopLevelCommand,
  topLevelCommand,
} from "../protocol/command-builder.js";
import { throwOnFatalProtocolStderr } from "./protocol-errors.js";

/** Show current constraints. */
export async function constraints(
  ctx: AgdaCommandContext,
): Promise<{ text: string }> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(rewriteTopLevelCommand("Cmd_constraints", "Normalised")),
  );
  throwOnFatalProtocolStderr(responses);
  return { text: decodeDisplayTextResponses(responses).text };
}

/** Solve all goals that have unique solutions. */
export async function solveAll(ctx: AgdaCommandContext): Promise<SolveResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(rewriteTopLevelCommand("Cmd_solveAll", "Normalised")),
  );
  throwOnFatalProtocolStderr(responses);
  ctx.syncGoalIdsFromResponses(responses);
  return { solutions: decodeSolveResponses(responses) };
}

/** Solve one goal that has a unique solution. */
export async function solveOne(
  ctx: AgdaCommandContext,
  goalId: number,
): Promise<SolveResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(rewriteGoalCommand("Cmd_solveOne", "Normalised", goalId, quoted(""))),
  );
  throwOnFatalProtocolStderr(responses);
  ctx.syncGoalIdsFromResponses(responses);
  return { solutions: decodeSolveResponses(responses) };
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
  throwOnFatalProtocolStderr(responses);
  return { explanation: decodeDisplayTextResponses(responses).text };
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
  throwOnFatalProtocolStderr(responses);
  return { explanation: decodeDisplayTextResponses(responses).text };
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
  throwOnFatalProtocolStderr(responses);
  return { elaboration: decodeGiveLikeResponse(responses) };
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
  throwOnFatalProtocolStderr(responses);
  return { helperType: decodeDisplayTextResponses(responses).text };
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
  throwOnFatalProtocolStderr(responses);
  return { contents: decodeDisplayTextResponses(responses).text };
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
  throwOnFatalProtocolStderr(responses);
  return { contents: decodeDisplayTextResponses(responses).text };
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
  throwOnFatalProtocolStderr(responses);
  const decoded = decodeSearchAboutResponses(responses);
  const text = decoded.results
    .map((entry) => `${entry.name} : ${entry.term}`)
    .join("\n");
  return {
    query: decoded.query || query,
    results: decoded.results,
    text,
  };
}

/** Auto-solve all goals. */
export async function autoAll(ctx: AgdaCommandContext): Promise<AutoResult> {
  ctx.requireFile();
  const responses = await ctx.sendCommand(
    ctx.iotcm(rewriteTopLevelCommand("Cmd_autoAll", "Normalised")),
  );
  throwOnFatalProtocolStderr(responses);
  ctx.syncGoalIdsFromResponses(responses);
  return { solution: decodeGiveLikeResponse(responses) };
}

/** Show the running Agda version. */
export async function showVersion(
  ctx: AgdaCommandContext,
): Promise<ShowVersionResult> {
  const responses = await ctx.sendCommand(ctx.iotcm("Cmd_show_version"));
  throwOnFatalProtocolStderr(responses);
  const version =
    decodeDisplayTextResponses(responses, {
      infoKinds: ["Version"],
      position: "first",
    }).text ||
    decodeDisplayTextResponses(responses).text;
  return { version };
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
  throwOnFatalProtocolStderr(responses);
  const decoded = decodeGoalExpressionDisplayResponses(responses);
  return {
    goalType: decoded.goalType,
    context: decoded.context,
    inferredType: decoded.inferredType,
  };
}
