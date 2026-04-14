// MIT License — see LICENSE
//
// Session-aware gates and validators used by tool registration wrappers.
//
// These helpers short-circuit a tool call before it reaches Agda when the
// session state makes a meaningful answer impossible — a missing loaded
// file (validateGoalId), a stale file (stalenessWarning), or a session
// whose most recent load failed with type-error (sessionErrorStateGate).
// Every gate returns a complete ToolResult that the caller returns
// directly, which keeps the gating policy in one place and out of
// individual tool callbacks.

import type { AgdaSession } from "../agda-process.js";

import {
  errorDiagnostic,
  errorEnvelope,
  infoDiagnostic,
  makeToolResult,
  type ToolResult,
} from "./tool-envelope.js";

/** Return a staleness warning if the loaded file was modified on disk. */
export function stalenessWarning(session: AgdaSession): string {
  if (session.isFileStale()) {
    return "**Warning:** File modified since last load — results may be stale. Run `agda_load` to refresh.\n\n";
  }
  return "";
}

// Matches the leading file path in an Agda diagnostic. Same family of
// patterns as parse-load-responses.ts#ERROR_LOCATION_PATTERN, but we
// capture the filename (group 1) instead of the line number because
// the caller cares about which file the diagnostic is *about*, not
// where in it the error was. Deliberately loose on the path so that
// both absolute and relative forms match, and both .agda and .lagda
// variants are recognized.
const DIAGNOSTIC_FILE_PATTERN = /([^\s:]+?\.(?:lagda\.md|lagda|agda)):\d+/u;

/**
 * Group diagnostic strings by the file path mentioned at their head.
 *
 * §1.2 from docs/bug-reports/agent-ux-observations.md: an agent that
 * calls agda_metas after a seemingly-clean agda_load can see a
 * well-formatted error from a transitive dependency of the loaded
 * file. Today those messages are a flat string array with no source
 * attribution, so the agent can't distinguish "the loaded file is
 * broken" from "a dependency is broken". Grouping the messages by the
 * file they reference — with a null bucket for messages whose text
 * didn't carry a parseable file path — gives that attribution back.
 *
 * Ordering: the returned array preserves insertion order (the order
 * files were first seen in the input), which matches the order in
 * which Agda emitted the diagnostics.
 */
export function groupDiagnosticsByFile(
  messages: readonly string[],
): Array<{ file: string | null; messages: string[] }> {
  const groups = new Map<string | null, string[]>();
  for (const message of messages) {
    if (typeof message !== "string" || message.length === 0) continue;
    const match = DIAGNOSTIC_FILE_PATTERN.exec(message);
    const file = match ? match[1] : null;
    const bucket = groups.get(file);
    if (bucket) {
      bucket.push(message);
    } else {
      groups.set(file, [message]);
    }
  }
  return Array.from(groups, ([file, msgs]) => ({ file, messages: msgs }));
}

/**
 * Session-error gate for query-style tools.
 *
 * When the session's most recent load returned a "type-error"
 * classification, query tools like agda_why_in_scope / agda_infer /
 * agda_compute / agda_search_about / agda_show_module cannot produce
 * a meaningful answer — Agda's interactive process will echo the
 * previous load error as the "result" of the query, which gets
 * embedded in a happy-path payload and silently mislead the caller
 * (observations doc §1.3). Query-tool callbacks should call this gate
 * before invoking Agda: if it returns non-null, return the value
 * immediately; otherwise proceed.
 *
 * The gate is conservative: it only triggers on `lastClassification ===
 * "type-error"`. `ok-with-holes` loads, `ok-complete` loads, and the
 * no-load-yet state all let the query run as before.
 */
export function sessionErrorStateGate<T extends Record<string, unknown>>(
  session: AgdaSession,
  tool: string,
  emptyData: T,
): ToolResult<T> | null {
  const lastClassification = session.getLastClassification?.() ?? null;
  if (lastClassification !== "type-error") {
    return null;
  }
  const loadedFile = session.getLoadedFile?.() ?? null;
  const fileHint = loadedFile ? ` (loaded file: ${loadedFile})` : "";
  const summary =
    `${tool} is unavailable: the session's most recent load failed `
    + `with classification 'type-error'${fileHint}. `
    + `Fix the load errors first, then re-run agda_load before issuing queries.`;
  return makeToolResult(
    errorEnvelope({
      tool,
      summary,
      classification: "unavailable",
      data: emptyData,
      diagnostics: [
        errorDiagnostic(summary, "session-unavailable", "agda_load"),
        infoDiagnostic(
          "Fix the type errors in the source file, then call agda_load to reload.",
          "recovery-hint",
          "agda_load",
        ),
      ],
    }),
    summary,
  );
}

/**
 * Validate a goalId against the session's current goals.
 * Returns an error response if invalid, or null if valid.
 */
export function validateGoalId(
  session: AgdaSession,
  goalId: number,
  tool = "unknown",
): ToolResult | null {
  const loaded = session.getLoadedFile();
  if (!loaded) {
    return makeToolResult(
      errorEnvelope({
        tool,
        summary: "No file loaded. Call `agda_load` first.",
        classification: "no-loaded-file",
        data: { goalId },
        diagnostics: [
          errorDiagnostic(
            "No file loaded. Call `agda_load` first.",
            "no-loaded-file",
            "agda_load",
          ),
        ],
      }),
    );
  }
  const ids = session.getGoalIds();
  if (!ids.includes(goalId)) {
    const available = ids.length > 0
      ? ids.map((id) => `?${id}`).join(", ")
      : "(none)";
    return makeToolResult(
      errorEnvelope({
        tool,
        summary: `Invalid goal ID ?${goalId}. Available goals: ${available}`,
        classification: "invalid-goal",
        data: { text: "", goalId, availableGoalIds: ids },
        diagnostics: [
          errorDiagnostic(
            `Invalid goal ID ?${goalId}. Available goals: ${available}`,
            "invalid-goal",
          ),
          infoDiagnostic(
            "Run `agda_load` to refresh goals after modifying the file.",
            "reload-hint",
            "agda_load",
          ),
        ],
      }),
      `Invalid goal ID ?${goalId}. Available goals: ${available}\n\n` +
      "Hint: Run `agda_load` to refresh goals after modifying the file.",
    );
  }
  return null;
}
