import type { AgdaResponse } from "../../agda/types.js";
import {
  interactionPointsResponseSchema,
  parseResponseWithSchema,
  stderrOutputResponseSchema,
} from "../response-schemas.js";

export function decodeInteractionPointIds(
  responses: AgdaResponse[],
): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();

  for (const response of responses) {
    const interactionPoints = parseResponseWithSchema(
      interactionPointsResponseSchema,
      response,
    );
    if (!interactionPoints) {
      continue;
    }

    for (const id of interactionPoints.interactionPoints) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  return ids;
}

export function decodeStderrOutputs(
  responses: AgdaResponse[],
): string[] {
  const texts: string[] = [];

  for (const response of responses) {
    const stderr = parseResponseWithSchema(stderrOutputResponseSchema, response);
    if (!stderr) {
      continue;
    }

    const text = stderr.text.trim();
    if (text) {
      texts.push(text);
    }
  }

  return texts;
}
