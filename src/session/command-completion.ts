export interface CommandCompletionSnapshot {
  sawStatusDone: boolean;
  responseCount: number;
}

export interface ResponseLike {
  kind: string;
  text?: string;
  status?: string;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function configuredCommandTimeoutMs(): number {
  return parsePositiveInt(process.env.AGDA_MCP_COMMAND_TIMEOUT_MS, 120_000);
}

export function configuredIdleCompletionMs(): number {
  return parsePositiveInt(process.env.AGDA_MCP_IDLE_COMPLETION_MS, 250);
}

export function configuredWaitingSentryMs(): number {
  return parsePositiveInt(process.env.AGDA_MCP_WAITING_SENTRY_MS, 0);
}

export function trailingResponseDelay(
  snapshot: CommandCompletionSnapshot,
): number {
  if (snapshot.sawStatusDone) {
    return 50;
  }

  if (snapshot.responseCount > 0) {
    return 200;
  }

  return 0;
}

export function shouldResolveOnIdle(
  snapshot: CommandCompletionSnapshot,
): boolean {
  return !snapshot.sawStatusDone && snapshot.responseCount > 0;
}

export function summarizeResponseKinds(
  responses: Array<{ kind: string }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const response of responses) {
    counts[response.kind] = (counts[response.kind] ?? 0) + 1;
  }
  return counts;
}

function previewText(value: string | undefined, limit = 120): string | undefined {
  if (!value) {
    return undefined;
  }

  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) {
    return compact;
  }
  return `${compact.slice(0, limit - 3)}...`;
}

export function tailResponsePreview(
  responses: ResponseLike[],
  count = 5,
): Array<Record<string, string>> {
  return responses.slice(-count).map((response) => {
    const preview: Record<string, string> = {
      kind: response.kind,
    };

    const status = previewText(response.status, 80);
    if (status) {
      preview.status = status;
    }

    const text = previewText(response.text);
    if (text) {
      preview.text = text;
    }

    return preview;
  });
}
