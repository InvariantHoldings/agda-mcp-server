import type { AgdaResponse } from "../../agda/types.js";
import { extractMessage } from "../../agda/response-parsing.js";

export interface DisplayTextDecodeOptions {
  infoKinds?: string[];
  position?: "first" | "last";
}

export interface DisplayTextDecodeResult {
  text: string;
  messages: string[];
}

export function decodeDisplayTextResponses(
  responses: AgdaResponse[],
  options: DisplayTextDecodeOptions = {},
): DisplayTextDecodeResult {
  const messages: string[] = [];

  for (const response of responses) {
    if (response.kind !== "DisplayInfo") {
      continue;
    }

    const info = response.info as Record<string, unknown> | undefined;
    if (!info) {
      continue;
    }

    if (
      options.infoKinds &&
      typeof info.kind === "string" &&
      !options.infoKinds.includes(info.kind)
    ) {
      continue;
    }

    const message = extractMessage(info);
    if (message) {
      messages.push(message);
    }
  }

  const text = options.position === "first"
    ? (messages[0] ?? "")
    : (messages.at(-1) ?? "");

  return { text, messages };
}
