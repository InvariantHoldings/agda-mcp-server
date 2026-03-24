import type { AgdaResponse } from "../../agda/types.js";
import { extractMessage } from "../../agda/response-parsing.js";

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
  if (resp.kind !== "Status") {
    return EMPTY_STATE;
  }

  const status =
    resp.status && typeof resp.status === "object"
      ? (resp.status as Record<string, unknown>)
      : (resp as Record<string, unknown>);

  return {
    checked: parseBoolean(status.checked),
    showImplicitArguments: parseBoolean(status.showImplicitArguments),
    showIrrelevantArguments: parseBoolean(status.showIrrelevantArguments),
  };
}

export function decodeProcessControlResponses(
  responses: AgdaResponse[],
): DecodedProcessControlResponses {
  const messages: string[] = [];
  let state: DisplayStateSnapshot = { ...EMPTY_STATE };

  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (info) {
        const msg = extractMessage(info).trim();
        if (msg) messages.push(msg);
      }
      continue;
    }

    if (resp.kind === "RunningInfo") {
      const payload = resp as Record<string, unknown>;
      const msg = [payload.message, payload.text]
        .find((part) => typeof part === "string");
      if (typeof msg === "string" && msg.trim()) {
        messages.push(msg.trim());
      }
      continue;
    }

    if (resp.kind === "StderrOutput") {
      const text = String(resp.text ?? "").trim();
      if (text) messages.push(text);
      continue;
    }

    if (resp.kind === "DoneAborting") {
      messages.push("Abort completed.");
      continue;
    }

    if (resp.kind === "DoneExiting") {
      messages.push("Exit completed.");
      continue;
    }

    if (resp.kind === "Status") {
      state = extractStatusState(resp);
    }
  }

  return { messages, state };
}
