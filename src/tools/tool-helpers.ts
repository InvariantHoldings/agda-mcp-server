// MIT License — see LICENSE
//
// Shared helpers for MCP tool handlers: staleness warnings, goal validation.

import type { AgdaSession } from "../agda-process.js";

/** Return a staleness warning if the loaded file was modified on disk. */
export function stalenessWarning(session: AgdaSession): string {
  if (session.isFileStale()) {
    return "**Warning:** File modified since last load — results may be stale. Run `agda_load` to refresh.\n\n";
  }
  return "";
}

/** MCP text content helper. */
export function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

/**
 * Validate a goalId against the session's current goals.
 * Returns an error response if invalid, or null if valid.
 */
export function validateGoalId(
  session: AgdaSession,
  goalId: number,
): ReturnType<typeof text> | null {
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
