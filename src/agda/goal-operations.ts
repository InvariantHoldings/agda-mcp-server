// MIT License — see LICENSE
//
// Goal-oriented Agda interaction commands.
//
// Each function receives an AgdaSessionContext and delegates the IOTCM
// protocol work through it, keeping the session class thin.

import type {
  AgdaSessionContext,
  AgdaResponse,
  AgdaGoal,
  GoalInfo,
  CaseSplitResult,
  GiveResult,
  AutoResult,
} from "./types.js";
import { extractMessage, escapeAgdaString } from "./response-parsing.js";

/**
 * Get the type and local context for a specific goal.
 */
export async function goalTypeContext(
  ctx: AgdaSessionContext,
  goalId: number,
): Promise<GoalInfo> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_goal_type_context Normalised ${goalId} noRange ""`,
  );
  const responses = await ctx.sendCommand(cmd);

  let type = "";
  const context: string[] = [];

  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info?.kind === "GoalSpecific") {
        const goalInfo = info.goalInfo as Record<string, unknown> | undefined;
        if (goalInfo) {
          type = extractMessage(goalInfo);
        }
      }
      if (info?.kind === "GoalType") {
        type = extractMessage(info);
      }
    }
  }

  // Parse context from the type display (Agda formats it as "ctx\n----\ngoalType")
  if (type.includes("————")) {
    const parts = type.split(/————+/);
    if (parts.length >= 2) {
      const ctxLines = parts[0].trim().split("\n").filter((l) => l.trim());
      context.push(...ctxLines);
      type = parts[parts.length - 1].trim();
    }
  }

  return { goalId, type, context, raw: responses };
}

/**
 * Case-split on a variable in a goal.
 */
export async function caseSplit(
  ctx: AgdaSessionContext,
  goalId: number,
  variable: string,
): Promise<CaseSplitResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_make_case ${goalId} noRange "${variable}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  const clauses: string[] = [];
  for (const resp of responses) {
    if (resp.kind === "MakeCase") {
      const cs = resp.clauses as string[] | undefined;
      if (Array.isArray(cs)) {
        clauses.push(...cs);
      }
    }
    // Also check DisplayInfo for MakeCase results
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        const msg = extractMessage(info);
        if (msg && clauses.length === 0) {
          clauses.push(msg);
        }
      }
    }
  }

  return { clauses, raw: responses };
}

/**
 * Give (fill) a goal with an expression.
 */
export async function give(
  ctx: AgdaSessionContext,
  goalId: number,
  expr: string,
): Promise<GiveResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_give WithoutForce ${goalId} noRange "${escapeAgdaString(expr)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let result = "";
  for (const resp of responses) {
    if (resp.kind === "GiveAction") {
      result = String(resp.giveResult ?? resp.result ?? "");
    }
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        const msg = extractMessage(info);
        if (msg) result = msg;
      }
    }
  }

  return { result, raw: responses };
}

/**
 * Refine a goal -- apply a function and create subgoals.
 */
export async function refine(
  ctx: AgdaSessionContext,
  goalId: number,
  expr: string,
): Promise<GiveResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_refine_or_intro True ${goalId} noRange "${escapeAgdaString(expr)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let result = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        result = extractMessage(info);
      }
    }
  }

  return { result, raw: responses };
}

/**
 * Auto-solve a single goal.
 */
export async function autoOne(
  ctx: AgdaSessionContext,
  goalId: number,
): Promise<AutoResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_autoOne ${goalId} noRange ""`,
  );
  const responses = await ctx.sendCommand(cmd);

  let solution = "";
  for (const resp of responses) {
    if (resp.kind === "GiveAction") {
      solution = String(resp.giveResult ?? resp.result ?? "");
    }
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        const msg = extractMessage(info);
        if (msg) solution = msg;
      }
    }
  }

  return { solution, raw: responses };
}

/**
 * List all unsolved metavariables (goals).
 */
export async function metas(
  ctx: AgdaSessionContext,
): Promise<{ goals: AgdaGoal[]; text: string; raw: AgdaResponse[] }> {
  ctx.requireFile();
  const cmd = ctx.iotcm("Cmd_metas");
  const responses = await ctx.sendCommand(cmd);

  let text = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        text = extractMessage(info);
      }
    }
  }

  return {
    goals: ctx.goalIds.map((id) => ({ goalId: id, type: "?", context: [] })),
    text,
    raw: responses,
  };
}
