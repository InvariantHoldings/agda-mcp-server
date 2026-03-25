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

  // AllGoalsWarnings has visibleGoals, invisibleGoals, errors, warnings
  // In --interaction-json mode these are arrays of objects, not strings.
  if (info.visibleGoals !== undefined || info.invisibleGoals !== undefined) {
    const parts: string[] = [];
    for (const field of ["visibleGoals", "invisibleGoals", "warnings", "errors"] as const) {
      const val = info[field];
      if (typeof val === "string") {
        parts.push(val);
      } else if (Array.isArray(val) && val.length > 0) {
        parts.push(val.map((item: Record<string, unknown>) =>
          typeof item === "string" ? item : (typeof item.type === "string" ? item.type : JSON.stringify(item))
        ).join("\n"));
      }
    }
    if (parts.length > 0) return parts.join("\n\n");
  }

  // Fallback: stringify
  return JSON.stringify(info, null, 2);
}

/**
 * Coerce an Agda response field to a string.
 * Handles: string → pass-through, array → join elements, object → stringify.
 * Returns "" for null/undefined.
 */
export function coerceString(val: unknown): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val)) {
    return val
      .map((item) =>
        typeof item === "string"
          ? item
          : item && typeof item === "object" && typeof (item as Record<string, unknown>).type === "string"
            ? (item as Record<string, unknown>).type as string
            : JSON.stringify(item),
      )
      .join("\n");
  }
  if (val != null) return String(val);
  return "";
}

/** Escape a string for embedding in an Agda IOTCM command. */
export function escapeAgdaString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}
