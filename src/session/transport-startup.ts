import type { AgdaResponse } from "../agda/types.js";

export function startupFailure(
  startupFault: Error | null,
  startupResponses: readonly AgdaResponse[],
): Error | null {
  if (startupFault) return startupFault;
  for (const response of startupResponses) {
    if (response.kind !== "DisplayInfo") continue;
    const info = response.info;
    if (info && typeof info === "object" &&
      (info as { kind?: unknown }).kind === "Error") {
      const detail = (info as { message?: unknown; error?: unknown }).message ??
        (info as { message?: unknown; error?: unknown }).error;
      return new Error(
        typeof detail === "string" && detail.length > 0
          ? detail
          : "Agda startup reported an Error response",
      );
    }
  }
  return null;
}
