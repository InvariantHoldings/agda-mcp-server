import type { AgdaResponse } from "../../agda/types.js";
import {
  displayInfoResponseSchema,
  parseResponseWithSchema,
  runningInfoResponseSchema,
  stderrOutputResponseSchema,
} from "../response-schemas.js";
import { decodeDisplayInfoEvents } from "./display-info.js";

export interface DecodedBackendResponses {
  output: string;
  success: boolean;
}

export function decodeBackendResponses(
  responses: AgdaResponse[],
): DecodedBackendResponses {
  const lines = decodeDisplayInfoEvents(responses)
    .map((event) => event.text.trim())
    .filter(Boolean);
  let success = true;

  for (const resp of responses) {
    const display = parseResponseWithSchema(displayInfoResponseSchema, resp);
    if (display) {
      if (display.info.kind === "Error") {
        success = false;
      }
      continue;
    }

    const running = parseResponseWithSchema(runningInfoResponseSchema, resp);
    if (running) {
      const message = (running.message ?? running.text ?? "").trim();
      if (message) lines.push(message);
      continue;
    }

    const stderr = parseResponseWithSchema(stderrOutputResponseSchema, resp);
    if (stderr) {
      const text = stderr.text.trim();
      if (text) {
        lines.push(text);
        if (/\berror\b/i.test(text)) {
          success = false;
        }
      }
    }
  }

  return {
    output: lines.join("\n"),
    success,
  };
}
