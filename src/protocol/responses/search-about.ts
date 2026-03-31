import type { AgdaResponse } from "../../agda/types.js";
import {
  parseResponseWithSchema,
  searchAboutEntrySchema,
  searchAboutInfoSchema,
} from "../response-schemas.js";
import { decodeDisplayInfoEvents } from "./display-info.js";

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

  for (const event of decodeDisplayInfoEvents(responses)) {
    const info = parseResponseWithSchema(searchAboutInfoSchema, event.payload);
    if (!info) {
      continue;
    }

    if (info.search) {
      query = info.search;
    }

    for (const rawEntry of info.results ?? []) {
      const entry = searchAboutEntrySchema.safeParse(rawEntry);
      if (entry.success) {
        results.push({ name: entry.data.name, term: entry.data.term });
      }
    }
  }

  return { query, results };
}
