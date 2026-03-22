// MIT License — see LICENSE
//
// Expression-level Agda commands: compute (normalize) and infer (type-check).
//
// Each function receives an AgdaSessionContext and delegates the IOTCM
// protocol work through it, keeping the session class thin.

import type {
  AgdaSessionContext,
  ComputeResult,
  InferResult,
} from "./types.js";
import { extractMessage, escapeAgdaString } from "./response-parsing.js";

/**
 * Normalize (evaluate) a term in a goal context.
 */
export async function compute(
  ctx: AgdaSessionContext,
  goalId: number,
  expr: string,
): Promise<ComputeResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_compute DefaultCompute ${goalId} noRange "${escapeAgdaString(expr)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let normalForm = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info?.kind === "NormalForm" || info?.kind === "GoalSpecific") {
        normalForm = extractMessage(info);
      }
      if (!normalForm) {
        normalForm = extractMessage(info ?? {});
      }
    }
  }

  return { normalForm, raw: responses };
}

/**
 * Normalize a top-level expression (not in a goal context).
 */
export async function computeTopLevel(
  ctx: AgdaSessionContext,
  expr: string,
): Promise<ComputeResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_compute_toplevel DefaultCompute "${escapeAgdaString(expr)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let normalForm = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        normalForm = extractMessage(info);
      }
    }
  }

  return { normalForm, raw: responses };
}

/**
 * Infer the type of an expression in a goal context.
 */
export async function infer(
  ctx: AgdaSessionContext,
  goalId: number,
  expr: string,
): Promise<InferResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_infer Normalised ${goalId} noRange "${escapeAgdaString(expr)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let type = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info?.kind === "InferredType" || info?.kind === "GoalSpecific") {
        type = extractMessage(info);
      }
      if (!type) {
        type = extractMessage(info ?? {});
      }
    }
  }

  return { type, raw: responses };
}

/**
 * Infer the type of a top-level expression.
 */
export async function inferTopLevel(
  ctx: AgdaSessionContext,
  expr: string,
): Promise<InferResult> {
  ctx.requireFile();
  const cmd = ctx.iotcm(
    `Cmd_infer_toplevel Normalised "${escapeAgdaString(expr)}"`,
  );
  const responses = await ctx.sendCommand(cmd);

  let type = "";
  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        type = extractMessage(info);
      }
    }
  }

  return { type, raw: responses };
}
