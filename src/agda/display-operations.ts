// MIT License — see LICENSE
//
// Display and highlighting controls for Agda's interaction mode.

import type {
  AgdaCommandContext,
  DisplayControlResult,
} from "./types.js";
import { decodeProcessControlResponses } from "../protocol/responses/process-controls.js";
import { boolLiteral, command, goalCommand, quoted } from "../protocol/command-builder.js";

function formatDisplayState(result: DisplayControlResult): string {
  const stateParts: string[] = [];
  if (result.showImplicitArguments !== null) {
    stateParts.push(`showImplicitArguments=${result.showImplicitArguments}`);
  }
  if (result.showIrrelevantArguments !== null) {
    stateParts.push(`showIrrelevantArguments=${result.showIrrelevantArguments}`);
  }
  if (result.checked !== null) {
    stateParts.push(`checked=${result.checked}`);
  }

  if (stateParts.length === 0) {
    return result.output;
  }

  const stateLine = `Session state: ${stateParts.join(", ")}`;
  return result.output ? `${result.output}\n${stateLine}` : stateLine;
}

async function runControl(
  ctx: AgdaCommandContext,
  agdaCommand: string,
  fallbackOutput: string,
): Promise<DisplayControlResult> {
  const responses = await ctx.sendCommand(ctx.iotcm(agdaCommand));
  const decoded = decodeProcessControlResponses(responses);

  const result: DisplayControlResult = {
    output: decoded.messages.join("\n") || fallbackOutput,
    checked: decoded.state.checked,
    showImplicitArguments: decoded.state.showImplicitArguments,
    showIrrelevantArguments: decoded.state.showIrrelevantArguments,
    raw: responses,
  };

  result.output = formatDisplayState(result);
  return result;
}

export async function loadHighlightingInfo(
  ctx: AgdaCommandContext,
  filePath: string,
): Promise<DisplayControlResult> {
  return runControl(
    ctx,
    command("Cmd_load_highlighting_info", quoted(filePath)),
    `Loaded highlighting info for ${filePath}.`,
  );
}

export async function tokenHighlighting(
  ctx: AgdaCommandContext,
  filePath: string,
  remove = false,
): Promise<DisplayControlResult> {
  return runControl(
    ctx,
    command("Cmd_tokenHighlighting", quoted(filePath), remove ? "Remove" : "Keep"),
    `${remove ? "Removed" : "Kept"} token highlighting for ${filePath}.`,
  );
}

export async function highlight(
  ctx: AgdaCommandContext,
  goalId: number,
  expr: string,
): Promise<DisplayControlResult> {
  ctx.requireFile();
  return runControl(
    ctx,
    goalCommand("Cmd_highlight", goalId, quoted(expr)),
    `Highlighting updated for ?${goalId}.`,
  );
}

export async function showImplicitArgs(
  ctx: AgdaCommandContext,
  show: boolean,
): Promise<DisplayControlResult> {
  return runControl(
    ctx,
    command("ShowImplicitArgs", boolLiteral(show)),
    `ShowImplicitArgs set to ${show}.`,
  );
}

export async function toggleImplicitArgs(
  ctx: AgdaCommandContext,
): Promise<DisplayControlResult> {
  return runControl(ctx, "ToggleImplicitArgs", "Toggled implicit arguments visibility.");
}

export async function showIrrelevantArgs(
  ctx: AgdaCommandContext,
  show: boolean,
): Promise<DisplayControlResult> {
  return runControl(
    ctx,
    command("ShowIrrelevantArgs", boolLiteral(show)),
    `ShowIrrelevantArgs set to ${show}.`,
  );
}

export async function toggleIrrelevantArgs(
  ctx: AgdaCommandContext,
): Promise<DisplayControlResult> {
  return runControl(
    ctx,
    "ToggleIrrelevantArgs",
    "Toggled irrelevant arguments visibility.",
  );
}
