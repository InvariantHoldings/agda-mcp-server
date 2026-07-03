// MIT License — see LICENSE
//
// Shared shape for the "still waiting" sentry log and the timeout log in
// AgdaTransport.sendCommand. Both describe the same in-flight snapshot, so
// keeping the field set in one place avoids the two drifting apart.

import {
  summarizeResponseKinds,
  tailResponsePreview,
  type ResponseLike,
} from "./command-completion.js";

export interface WaitDiagnosticsInput {
  command: string;
  startTimeMs: number;
  nowMs: number;
  responseQueue: ResponseLike[];
  sawStatusDone: boolean;
  lastResponseAt: number | null;
  lastResponseKind: string | null;
  timeoutMs?: number;
}

export function waitDiagnostics(input: WaitDiagnosticsInput): Record<string, unknown> {
  const diag: Record<string, unknown> = {
    command: input.command.slice(0, 100),
    responseCount: input.responseQueue.length,
    sawStatusDone: input.sawStatusDone,
    elapsedMs: input.nowMs - input.startTimeMs,
    msSinceLastResponse: input.lastResponseAt === null
      ? null
      : input.nowMs - input.lastResponseAt,
    lastResponseKind: input.lastResponseKind,
    responseKinds: summarizeResponseKinds(input.responseQueue),
    responseTail: tailResponsePreview(input.responseQueue),
  };
  if (input.timeoutMs !== undefined) {
    diag.timeoutMs = input.timeoutMs;
  }
  return diag;
}
