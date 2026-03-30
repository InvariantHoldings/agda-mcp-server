import type { AgdaResponse } from "../../agda/types.js";

export interface SearchAboutEntry {
  name: string;
  term: string;
}

export interface DecodedSearchAbout {
  query: string;
  results: SearchAboutEntry[];
}

export function decodeSearchAboutResponses(
  responses: AgdaResponse[],
): DecodedSearchAbout {
  let query = "";
  const results: SearchAboutEntry[] = [];

  for (const response of responses) {
    if (response.kind !== "DisplayInfo") {
      continue;
    }

    const info = response.info as Record<string, unknown> | undefined;
    if (!info || info.kind !== "SearchAbout") {
      continue;
    }

    if (typeof info.search === "string") {
      query = info.search;
    }

    const rawResults = info.results;
    if (!Array.isArray(rawResults)) {
      continue;
    }

    for (const raw of rawResults) {
      if (!raw || typeof raw !== "object") {
        continue;
      }

      const candidate = raw as Record<string, unknown>;
      const name = candidate.name;
      const term = candidate.term;

      if (typeof name !== "string" || typeof term !== "string") {
        continue;
      }

      results.push({ name, term });
    }
  }

  return { query, results };
}
