import { readFileSync } from "node:fs";
import { z } from "zod";

export function loadJsonData<T>(
  relativePath: string,
  schema: z.ZodType<T>,
  baseUrl: string,
): T {
  const url = new URL(relativePath, baseUrl);
  const raw = readFileSync(url, "utf8");
  return schema.parse(JSON.parse(raw));
}
