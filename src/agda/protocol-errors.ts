import type { AgdaResponse } from "./types.js";
import { decodeStderrOutputs } from "../protocol/responses/process-output.js";

const FATAL_PROTOCOL_PATTERNS = [
  /^cannot read:/i,
  /^failed to parse/i,
  /^invalid\b/i,
];

export function throwOnFatalProtocolStderr(responses: AgdaResponse[]): void {
  const fatal = decodeStderrOutputs(responses)
    .map((text) => text.trim())
    .filter((text) => FATAL_PROTOCOL_PATTERNS.some((pattern) => pattern.test(text)));

  if (fatal.length > 0) {
    throw new Error(fatal.join("\n"));
  }
}
