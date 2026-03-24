import type { AgdaResponse } from "../../agda/types.js";
import { extractMessage } from "../../agda/response-parsing.js";

export function decodeGiveLikeResponse(responses: AgdaResponse[]): string {
  let result = "";

  for (const resp of responses) {
    if (resp.kind === "GiveAction") {
      result = String(resp.giveResult ?? resp.result ?? result);
      continue;
    }

    if (resp.kind !== "DisplayInfo") continue;

    const info = resp.info as Record<string, unknown> | undefined;
    if (!info) continue;

    const msg = extractMessage(info);
    if (msg && !result) result = msg;
  }

  return result;
}

export function decodeSolveResponses(responses: AgdaResponse[]): string[] {
  const solutions: string[] = [];

  for (const resp of responses) {
    if (resp.kind === "SolveAll") {
      const rawSolutions = resp.solutions as Array<[number, string] | { interactionPoint?: number; expression?: string }> | undefined;
      if (Array.isArray(rawSolutions)) {
        for (const solution of rawSolutions) {
          if (Array.isArray(solution) && solution.length >= 2) {
            solutions.push(`?${solution[0]} := ${solution[1]}`);
            continue;
          }

          if (!Array.isArray(solution) && solution && typeof solution === "object") {
            const id = typeof solution.interactionPoint === "number" ? solution.interactionPoint : undefined;
            const expr = typeof solution.expression === "string" ? solution.expression : undefined;
            if (id !== undefined && expr) {
              solutions.push(`?${id} := ${expr}`);
            }
          }
        }
      }
      continue;
    }

    if (resp.kind !== "DisplayInfo") continue;

    const info = resp.info as Record<string, unknown> | undefined;
    if (!info) continue;

    const msg = extractMessage(info);
    if (msg) solutions.push(msg);
  }

  return solutions;
}
