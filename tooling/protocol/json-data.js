import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function loadValidatedJsonData(relativePath, schema, moduleUrl) {
  const baseDir = dirname(fileURLToPath(moduleUrl));
  const filePath = resolve(baseDir, relativePath);
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  return schema.parse(raw);
}
