// MIT License — see LICENSE
//
// Backend command support: compile and backend-specific payload commands.

import type {
  AgdaCommandContext,
  BackendCommandResult,
} from "./types.js";
import { decodeBackendResponses } from "../protocol/responses/backend.js";
import { parseBackendExpression } from "./backend-expression.js";
import { command, goalCommand, quoted, stringList } from "../protocol/command-builder.js";

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
    command("Cmd_compile", parsedBackend.expression, quoted(filePath), stringList(argv)),
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
    command("Cmd_backend_top", parsedBackend.expression, quoted(payload)),
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
    goalCommand("Cmd_backend_hole", goalId, quoted(holeContents), parsedBackend.expression, quoted(payload)),
    `Backend hole command sent for ?${goalId} using ${parsedBackend.displayName}.`,
  );
}
