// MIT License — see LICENSE
//
// Typed helpers for constructing Agda IOTCM command payloads.

import { escapeAgdaString } from "../agda/response-parsing.js";

export type CommandAtom = string | number;

function atom(value: CommandAtom): string {
  return String(value);
}

export function quoted(text: string): string {
  return `"${escapeAgdaString(text)}"`;
}

export function boolLiteral(value: boolean): "True" | "False" {
  return value ? "True" : "False";
}

export function stringList(values: string[]): string {
  if (values.length === 0) {
    return "[]";
  }

  return `[${values.map((value) => quoted(value)).join(", ")}]`;
}

export function command(name: string, ...parts: CommandAtom[]): string {
  return [name, ...parts.map(atom)].join(" ");
}

export function goalCommand(
  name: string,
  goalId: number,
  ...parts: CommandAtom[]
): string {
  return command(name, goalId, "noRange", ...parts);
}

export function modeGoalCommand(
  name: string,
  mode: CommandAtom,
  goalId: number,
  ...parts: CommandAtom[]
): string {
  return command(name, mode, goalId, "noRange", ...parts);
}

export function topLevelCommand(
  name: string,
  ...parts: CommandAtom[]
): string {
  return command(name, ...parts);
}

export function modeTopLevelCommand(
  name: string,
  mode: CommandAtom,
  ...parts: CommandAtom[]
): string {
  return command(name, mode, ...parts);
}
