import type { AgdaResponse } from "./types.js";
import { decodeStderrOutputs } from "../protocol/responses/process-output.js";

const FATAL_PROTOCOL_PATTERNS = [
  /^cannot read:/i,
  /^failed to parse/i,
  /^invalid\b/i,
];

/** True when stderr text is Agda rejecting the command itself (a
 *  malformed IOTCM it "cannot read", etc.) rather than reporting on the
 *  file. Agda emits this and keeps running without any goal state, so
 *  the transport must treat it as a load terminus or it waits the full
 *  command timeout for responses that never come. */
export function isFatalProtocolStderr(text: string): boolean {
  const trimmed = text.trim();
  return FATAL_PROTOCOL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function throwOnFatalProtocolStderr(responses: AgdaResponse[]): void {
  const fatal = decodeStderrOutputs(responses)
    .map((text) => text.trim())
    .filter((text) => isFatalProtocolStderr(text));

  if (fatal.length > 0) {
    throw new Error(fatal.join("\n"));
  }
}
