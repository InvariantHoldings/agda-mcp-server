// MIT License — see LICENSE
//
// Agda wire-format helpers: message extraction and string escaping.

/** Extract a human-readable message from an Agda DisplayInfo payload. */
export function extractMessage(info: Record<string, unknown>): string {
  // Try common message fields
  if (typeof info.message === "string") return info.message;
  if (typeof info.payload === "string") return info.payload;

  // GoalSpecific wraps another goalInfo
  if (info.goalInfo && typeof info.goalInfo === "object") {
    return extractMessage(info.goalInfo as Record<string, unknown>);
  }

  // Some responses use "contents" or "text"
  if (typeof info.contents === "string") return info.contents;
  if (typeof info.text === "string") return info.text;

  // AllGoalsWarnings has visibleGoals and invisibleGoals
  if (info.visibleGoals !== undefined || info.invisibleGoals !== undefined) {
    const parts: string[] = [];
    if (typeof info.visibleGoals === "string") parts.push(info.visibleGoals);
    if (typeof info.invisibleGoals === "string") parts.push(info.invisibleGoals);
    if (typeof info.warnings === "string") parts.push(info.warnings);
    if (typeof info.errors === "string") parts.push(info.errors);
    if (parts.length > 0) return parts.join("\n\n");
  }

  // Fallback: stringify
  return JSON.stringify(info, null, 2);
}

/** Escape a string for embedding in an Agda IOTCM command. */
export function escapeAgdaString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}
