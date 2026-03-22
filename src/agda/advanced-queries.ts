// MIT License — see LICENSE
//
// Advanced Agda interaction queries: constraints, scope, elaboration,
// module contents, search, and combined goal inspection.
//
// Each function receives an AgdaSessionContext and delegates the IOTCM
// protocol work through it, keeping the session class thin.

import type {
  AgdaSessionContext,
  AgdaResponse,
  WhyInScopeResult,
  ElaborateResult,
  HelperFunctionResult,
  ModuleContentsResult,
  SearchAboutResult,
  AutoResult,
  GoalTypeContextInferResult,
} from "./types.js";
import { extractMessage, escapeAgdaString } from "./response-parsing.js";

/**
 * Show current constraints.
 */
export async function constraints(
  ctx: AgdaSessionContext,
): Promise<{ text: string; raw: AgdaResponse[] }> {
  ctx.requireFile();
  const cmd = ctx.iotcm("Cmd_constraints");
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

  return { text, raw: responses };
}

/**
 * Solve all goals that have unique solutions.
 */
export async function solveAll(
  ctx: AgdaSessionContext,
): Promise<{ solutions: string[]; raw: AgdaResponse[] }> {
  ctx.requireFile();
  const cmd = ctx.iotcm("Cmd_solveAll Normalised");
  const responses = await ctx.sendCommand(cmd);

  const solutions: string[] = [];
  for (const resp of responses) {
    if (resp.kind === "SolveAll") {
      const solns = resp.solutions as Array<[number, string]> | undefined;
      if (Array.isArray(solns)) {
        for (const [id, expr] of solns) {
          solutions.push(`?${id} := ${expr}`);
        }
      }
    }
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        const msg = extractMessage(info);
        if (msg) solutions.push(msg);
      }
    }
  }

  return { solutions, raw: responses };
}

/**
 * Explain why a name is in scope at a given goal.
 */
export async function whyInScope(
  ctx: AgdaSessionContext,
  goalId: number,
  name: string,
): Promise<WhyInScopeResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_why_in_scope ${goalId} noRange "${escapeAgdaString(name)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let explanation = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        explanation = extractMessage(info);
      }
    }
  }

  return { explanation, raw: responses };
}

/**
 * Explain why a name is in scope at the top level.
 */
export async function whyInScopeTopLevel(
  ctx: AgdaSessionContext,
  name: string,
): Promise<WhyInScopeResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_why_in_scope_toplevel "${escapeAgdaString(name)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let explanation = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        explanation = extractMessage(info);
      }
    }
  }

  return { explanation, raw: responses };
}

/**
 * Elaborate an expression in a goal context (normalize and show full form).
 */
export async function elaborate(
  ctx: AgdaSessionContext,
  goalId: number,
  expr: string,
): Promise<ElaborateResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_elaborate_give Normalised ${goalId} noRange "${escapeAgdaString(expr)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let elaboration = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        elaboration = extractMessage(info);
      }
    }
    if (resp.kind === "GiveAction") {
      elaboration = String(resp.giveResult ?? resp.result ?? elaboration);
    }
  }

  return { elaboration, raw: responses };
}

/**
 * Generate a helper function type for an expression in a goal context.
 */
export async function helperFunction(
  ctx: AgdaSessionContext,
  goalId: number,
  expr: string,
): Promise<HelperFunctionResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_helper_function Normalised ${goalId} noRange "${escapeAgdaString(expr)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let helperType = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        helperType = extractMessage(info);
      }
    }
  }

  return { helperType, raw: responses };
}

/**
 * Show the contents of a module in a goal context.
 */
export async function showModuleContents(
  ctx: AgdaSessionContext,
  goalId: number,
  moduleName: string,
): Promise<ModuleContentsResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_show_module_contents Normalised ${goalId} noRange "${escapeAgdaString(moduleName)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let contents = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        contents = extractMessage(info);
      }
    }
  }

  return { contents, raw: responses };
}

/**
 * Show the contents of a module at the top level.
 */
export async function showModuleContentsTopLevel(
  ctx: AgdaSessionContext,
  moduleName: string,
): Promise<ModuleContentsResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_show_module_contents_toplevel Normalised "${escapeAgdaString(moduleName)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let contents = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        contents = extractMessage(info);
      }
    }
  }

  return { contents, raw: responses };
}

/**
 * Search for definitions matching a query string.
 */
export async function searchAbout(
  ctx: AgdaSessionContext,
  query: string,
): Promise<SearchAboutResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_search_about_toplevel Normalised "${escapeAgdaString(query)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let results = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        results = extractMessage(info);
      }
    }
  }

  return { results, raw: responses };
}

/**
 * Auto-solve all goals.
 */
export async function autoAll(
  ctx: AgdaSessionContext,
): Promise<AutoResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm("Cmd_autoAll Normalised");
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
        if (msg) solution = solution ? `${solution}\n${msg}` : msg;
      }
    }
  }

  return { solution, raw: responses };
}

/**
 * Get the goal type, context, and inferred type of an expression
 * in a goal context (combined query).
 */
export async function goalTypeContextInfer(
  ctx: AgdaSessionContext,
  goalId: number,
  expr: string,
): Promise<GoalTypeContextInferResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_goal_type_context_infer Normalised ${goalId} noRange "${escapeAgdaString(expr)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let goalType = "";
  let inferredType = "";
  const context: string[] = [];

  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info?.kind === "GoalSpecific") {
        const goalInfo = info.goalInfo as Record<string, unknown> | undefined;
        if (goalInfo) {
          const fullText = extractMessage(goalInfo);
          // Agda formats combined output with sections separated by ----
          if (fullText.includes("————")) {
            const parts = fullText.split(/————+/);
            if (parts.length >= 2) {
              const ctxLines = parts[0].trim().split("\n").filter((l) => l.trim());
              context.push(...ctxLines);
              goalType = parts[1]?.trim() ?? "";
              if (parts.length >= 3) {
                inferredType = parts[2].trim();
              }
            }
          } else {
            goalType = fullText;
          }
        }
      }
      if (info?.kind === "GoalType") {
        goalType = extractMessage(info);
      }
    }
  }

  return { goalType, context, inferredType, raw: responses };
}
