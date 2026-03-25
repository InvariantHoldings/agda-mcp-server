// MIT License — see LICENSE
//
// Reusable response extraction helpers. These eliminate the 15+
// identical "loop over responses, find DisplayInfo, extract message"
// patterns scattered across delegate modules.

import type { AgdaResponse } from "./types.js";
import { extractMessage } from "./response-parsing.js";

/**
 * Extract the first DisplayInfo message from a response sequence.
 * Optionally filter by info.kind (e.g., "NormalForm", "InferredType").
 */
export function firstDisplayMessage(
  responses: AgdaResponse[],
  infoKinds?: string[],
): string {
  for (const resp of responses) {
    if (resp.kind !== "DisplayInfo") continue;
    const info = resp.info as Record<string, unknown> | undefined;
    if (!info) continue;
    if (
      infoKinds &&
      typeof info.kind === "string" &&
      !infoKinds.includes(info.kind)
    )
      continue;
    const msg = extractMessage(info);
    if (msg) return msg;
  }
  return "";
}

/**
 * Extract a string field from the first response matching a kind.
 * E.g., firstResponseField(responses, "GiveAction", "giveResult")
 */
export function firstResponseField(
  responses: AgdaResponse[],
  kind: string,
  ...fields: string[]
): string {
  for (const resp of responses) {
    if (resp.kind !== kind) continue;
    const obj = resp as Record<string, unknown>;
    for (const field of fields) {
      const val = obj[field];
      if (typeof val === "string" && val) return val;
    }
  }
  return "";
}

/**
 * Extract the last DisplayInfo message (some commands return multiple,
 * and the last one is the most relevant).
 */
export function lastDisplayMessage(
  responses: AgdaResponse[],
  infoKinds?: string[],
): string {
  let result = "";
  for (const resp of responses) {
    if (resp.kind !== "DisplayInfo") continue;
    const info = resp.info as Record<string, unknown> | undefined;
    if (!info) continue;
    if (
      infoKinds &&
      typeof info.kind === "string" &&
      !infoKinds.includes(info.kind)
    )
      continue;
    const msg = extractMessage(info);
    if (msg) result = msg;
  }
  return result;
}
