import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

export function loadValidatedJsonData(relativePath, schema, moduleUrl) {
  const baseDir = dirname(new URL(moduleUrl).pathname);
  const filePath = resolve(baseDir, relativePath);
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  return schema.parse(raw);
}
