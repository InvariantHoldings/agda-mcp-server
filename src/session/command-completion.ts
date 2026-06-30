export interface CommandCompletionSnapshot {
  sawStatusDone: boolean;
  responseCount: number;
  lastResponseKind?: string | null;
  /**
   * This command is a metas `Cmd_load` whose goal-state terminus
   * (`AllGoalsWarnings` / `Error` / `InteractionPoints`) we must wait
   * for. Set only on that path; every other command leaves it false and
   * keeps the original fast idle behavior.
   */
  awaitGoalTerminus?: boolean;
  /** The awaited goal-state terminus has been observed. */
  sawGoalTerminus?: boolean;
}

export type CommandCompletionOrigin = "idle" | "signal" | "process-close";

export interface ResponseLike {
  kind: string;
  text?: string;
  status?: unknown;
}

const TERMINAL_IDLE_RESPONSE_KINDS = new Set([
  "DisplayInfo",
  "InteractionPoints",
  "GiveAction",
  "MakeCase",
  "SolveAll",
  "JumpToError",
  "CurrentGoal",
  "CompilationOk",
  "DoneAborting",
  "DoneExiting",
  "StderrOutput",
]);

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

export function configuredPostStatusIdleCompletionMs(): number {
  return parsePositiveInt(process.env.AGDA_MCP_POST_STATUS_IDLE_MS, 50);
}

/**
 * Idle window for a metas `Cmd_load` that has not yet emitted its
 * goal-state terminus. Much larger than the normal window so it exceeds
 * the compute gap a big module takes — after type-checking and after the
 * trailing `Status` — to normalise and serialise its goals. Applies only
 * while `awaitGoalTerminus` is set and the terminus is unseen, so a small
 * load (terminus arrives immediately) and every non-load command keep the
 * short window — no common-path latency.
 */
export function configuredGoalTerminusIdleMs(): number {
  return parsePositiveInt(process.env.AGDA_MCP_LOAD_TERMINUS_IDLE_MS, 2_000);
}

export function configuredWaitingSentryMs(): number {
  return parsePositiveInt(process.env.AGDA_MCP_WAITING_SENTRY_MS, 0);
}

export function idleCompletionDelay(
  snapshot: CommandCompletionSnapshot,
): number {
  if (snapshot.responseCount === 0) {
    return 0;
  }

  // A metas Cmd_load whose goal-state terminus hasn't arrived yet — the
  // command is not done regardless of what the last response was. Wait
  // far longer so the compute gap before the goals (which falls after the
  // trailing Status on a large module) isn't mistaken for completion.
  if (snapshot.awaitGoalTerminus && !snapshot.sawGoalTerminus) {
    return Math.max(
      configuredIdleCompletionMs(),
      configuredGoalTerminusIdleMs(),
    );
  }

  if (snapshot.sawStatusDone && snapshot.lastResponseKind === "Status") {
    return Math.max(
      configuredIdleCompletionMs(),
      configuredPostStatusIdleCompletionMs(),
    );
  }

  return configuredIdleCompletionMs();
}

export function trailingResponseDelay(
  snapshot: CommandCompletionSnapshot,
  origin: CommandCompletionOrigin = "signal",
): number {
  if (origin === "idle" || origin === "process-close") {
    return 0;
  }

  if (snapshot.sawStatusDone && snapshot.lastResponseKind && TERMINAL_IDLE_RESPONSE_KINDS.has(snapshot.lastResponseKind)) {
    return 25;
  }

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
  return snapshot.responseCount > 0;
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

function previewText(value: unknown, limit = 120): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const raw = typeof value === "string"
    ? value
    : (() => {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      })();

  const compact = raw.replace(/\s+/g, " ").trim();
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
