import type { AgdaResponse } from "../../agda/types.js";
import {
  doneAbortingResponseSchema,
  doneExitingResponseSchema,
  parseResponseWithSchema,
  runningInfoResponseSchema,
  statusResponseSchema,
  stderrOutputResponseSchema,
} from "../response-schemas.js";
import { decodeDisplayInfoEvents } from "./display-info.js";

export interface DisplayStateSnapshot {
  checked: boolean | null;
  showImplicitArguments: boolean | null;
  showIrrelevantArguments: boolean | null;
}

export interface DecodedProcessControlResponses {
  messages: string[];
  state: DisplayStateSnapshot;
}

const EMPTY_STATE: DisplayStateSnapshot = {
  checked: null,
  showImplicitArguments: null,
  showIrrelevantArguments: null,
};

function parseBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function extractStatusState(resp: AgdaResponse): DisplayStateSnapshot {
  const status = parseResponseWithSchema(statusResponseSchema, resp);
  if (!status) {
    return EMPTY_STATE;
  }

  const src =
    status.checked !== undefined
      ? status
      : status.status && typeof status.status === "object"
        ? status.status
        : status;

  return {
    checked: parseBoolean(src.checked),
    showImplicitArguments: parseBoolean(src.showImplicitArguments),
    showIrrelevantArguments: parseBoolean(src.showIrrelevantArguments),
  };
}

export function decodeProcessControlResponses(
  responses: AgdaResponse[],
): DecodedProcessControlResponses {
  const messages = decodeDisplayInfoEvents(responses)
    .map((event) => event.text.trim())
    .filter(Boolean);
  let state: DisplayStateSnapshot = { ...EMPTY_STATE };

  for (const resp of responses) {
    const running = parseResponseWithSchema(runningInfoResponseSchema, resp);
    if (running) {
      const msg = (running.message ?? running.text ?? "").trim();
      if (msg) {
        messages.push(msg);
      }
      continue;
    }

    const stderr = parseResponseWithSchema(stderrOutputResponseSchema, resp);
    if (stderr) {
      const text = stderr.text.trim();
      if (text) messages.push(text);
      continue;
    }

    if (parseResponseWithSchema(doneAbortingResponseSchema, resp)) {
      messages.push("Abort completed.");
      continue;
    }

    if (parseResponseWithSchema(doneExitingResponseSchema, resp)) {
      messages.push("Exit completed.");
      continue;
    }

    if (parseResponseWithSchema(statusResponseSchema, resp)) {
      state = extractStatusState(resp);
    }
  }

  return { messages, state };
}
