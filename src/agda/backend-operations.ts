// MIT License — see LICENSE
//
// Backend command support: compile and backend-specific payload commands.

import type {
  AgdaCommandContext,
  BackendCommandResult,
} from "./types.js";
import { escapeAgdaString } from "./response-parsing.js";
import { decodeBackendResponses } from "../protocol/responses/backend.js";
import { parseBackendExpression } from "./backend-expression.js";

function renderStringList(values: string[]): string {
  if (values.length === 0) {
    return "[]";
  }

  const rendered = values
    .map((value) => `\"${escapeAgdaString(value)}\"`)
    .join(", ");

  return `[${rendered}]`;
}

async function runBackendCommand(
  ctx: AgdaCommandContext,
  agdaCommand: string,
  fallbackOutput: string,
): Promise<BackendCommandResult> {
  const responses = await ctx.sendCommand(ctx.iotcm(agdaCommand));
  const decoded = decodeBackendResponses(responses);

  return {
    success: decoded.success,
    output: decoded.output || fallbackOutput,
    raw: responses,
  };
}

export async function compile(
  ctx: AgdaCommandContext,
  backendExpr: string,
  filePath: string,
  argv: string[],
): Promise<BackendCommandResult> {
  const parsedBackend = parseBackendExpression(backendExpr);

  return runBackendCommand(
    ctx,
    `Cmd_compile ${parsedBackend.expression} "${escapeAgdaString(filePath)}" ${renderStringList(argv)}`,
    `Compile command sent using backend ${parsedBackend.displayName}.`,
  );
}

export async function backendTop(
  ctx: AgdaCommandContext,
  backendExpr: string,
  payload: string,
): Promise<BackendCommandResult> {
  ctx.requireFile();
  const parsedBackend = parseBackendExpression(backendExpr);

  return runBackendCommand(
    ctx,
    `Cmd_backend_top ${parsedBackend.expression} "${escapeAgdaString(payload)}"`,
    `Backend top-level command sent using ${parsedBackend.displayName}.`,
  );
}

export async function backendHole(
  ctx: AgdaCommandContext,
  goalId: number,
  holeContents: string,
  backendExpr: string,
  payload: string,
): Promise<BackendCommandResult> {
  ctx.requireFile();
  const parsedBackend = parseBackendExpression(backendExpr);

  return runBackendCommand(
    ctx,
    `Cmd_backend_hole ${goalId} noRange "${escapeAgdaString(holeContents)}" ${parsedBackend.expression} "${escapeAgdaString(payload)}"`,
    `Backend hole command sent for ?${goalId} using ${parsedBackend.displayName}.`,
  );
}
