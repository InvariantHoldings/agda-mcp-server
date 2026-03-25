// MIT License — see LICENSE
//
// Shared helpers for MCP tool handlers: staleness warnings, goal
// validation, and higher-order wrappers that eliminate boilerplate.

import type { AgdaSession } from "../agda-process.js";

type ToolResult = { content: { type: "text"; text: string }[] };

/** Return a staleness warning if the loaded file was modified on disk. */
export function stalenessWarning(session: AgdaSession): string {
  if (session.isFileStale()) {
    return "**Warning:** File modified since last load — results may be stale. Run `agda_load` to refresh.\n\n";
  }
  return "";
}

/** MCP text content helper. */
export function text(t: string): ToolResult {
  return { content: [{ type: "text" as const, text: t }] };
}

/**
 * Validate a goalId against the session's current goals.
 * Returns an error response if invalid, or null if valid.
 */
export function validateGoalId(
  session: AgdaSession,
  goalId: number,
): ToolResult | null {
  const loaded = session.getLoadedFile();
  if (!loaded) {
    return text("No file loaded. Call `agda_load` first.");
  }
  const ids = session.getGoalIds();
  if (!ids.includes(goalId)) {
    const available = ids.length > 0
      ? ids.map((id) => `?${id}`).join(", ")
      : "(none)";
    return text(
      `Invalid goal ID ?${goalId}. Available goals: ${available}\n\n` +
      "Hint: Run `agda_load` to refresh goals after modifying the file.",
    );
  }
  return null;
}

/**
 * Wrap a session tool handler with staleness warning and error handling.
 * The handler returns a markdown string; the wrapper adds warning prefix
 * and catches errors.
 */
export function wrapHandler(
  session: AgdaSession,
  handler: () => Promise<string>,
): () => Promise<ToolResult> {
  return async () => {
    try {
      const warn = stalenessWarning(session);
      return text(warn + await handler());
    } catch (err) {
      return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

/**
 * Wrap a goal-based tool handler with validation, staleness warning,
 * and error handling. The handler receives the validated goalId and
 * returns a markdown string.
 */
export function wrapGoalHandler<A extends Record<string, unknown>>(
  session: AgdaSession,
  handler: (args: A & { goalId: number }) => Promise<string>,
): (args: A & { goalId: number }) => Promise<ToolResult> {
  return async (args) => {
    const invalid = validateGoalId(session, args.goalId);
    if (invalid) return invalid;
    try {
      const warn = stalenessWarning(session);
      return text(warn + await handler(args));
    } catch (err) {
      return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
