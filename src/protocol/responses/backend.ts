import type { AgdaResponse } from "../../agda/types.js";
import { extractMessage } from "../../agda/response-parsing.js";

export interface DecodedBackendResponses {
  output: string;
  success: boolean;
}

export function decodeBackendResponses(
  responses: AgdaResponse[],
): DecodedBackendResponses {
  const lines: string[] = [];
  let success = true;

  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (!info) continue;

      if (info.kind === "Error") {
        success = false;
      }

      const msg = extractMessage(info).trim();
      if (msg) lines.push(msg);
      continue;
    }

    if (resp.kind === "RunningInfo") {
      const message = ((resp.message as string) ?? "").trim();
      if (message) lines.push(message);
      continue;
    }

    if (resp.kind === "StderrOutput") {
      const text = ((resp.text as string) ?? "").trim();
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
