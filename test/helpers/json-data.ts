import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ZodType } from "zod";

export function loadJsonData(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadValidatedJsonData<T>(moduleDir: string, relativePath: string, schema: ZodType<T>): T {
  return schema.parse(loadJsonData(resolve(moduleDir, relativePath)));
}
