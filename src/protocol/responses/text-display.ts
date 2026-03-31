import type { AgdaResponse } from "../../agda/types.js";
import { decodeDisplayInfoEvents } from "./display-info.js";

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
  const messages = decodeDisplayInfoEvents(responses)
    .filter((event) =>
      !options.infoKinds || options.infoKinds.includes(event.infoKind)
    )
    .map((event) => event.text)
    .filter((message) => message.length > 0);

  const text = options.position === "first"
    ? (messages[0] ?? "")
    : (messages.at(-1) ?? "");

  return { text, messages };
}
