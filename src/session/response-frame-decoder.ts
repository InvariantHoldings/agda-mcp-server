import type { AgdaResponse } from "../agda/types.js";
import { allGoalsWarningsInfoSchema } from "../protocol/response-schemas.js";
import { normalizeAgdaResponse } from "../agda/normalize-response.js";

/** Parse one syntactically valid JSON frame into a checked Agda response. */
export function decodeResponse(text: string): AgdaResponse {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agda response must be a JSON object");
  }
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== "string" || kind.length === 0) {
    throw new Error("Agda response kind must be a non-empty string");
  }
  if (kind === "DisplayInfo") {
    const info = (value as { info?: unknown }).info;
    if (info && typeof info === "object" &&
      (info as { kind?: unknown }).kind === "AllGoalsWarnings" &&
      !allGoalsWarningsInfoSchema.safeParse(info).success) {
      throw new Error("Malformed AllGoalsWarnings response");
    }
  }
  return normalizeAgdaResponse(value as AgdaResponse);
}
