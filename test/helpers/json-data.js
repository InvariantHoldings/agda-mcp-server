import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadJsonData(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadValidatedJsonData(moduleDir, relativePath, schema) {
  return schema.parse(loadJsonData(resolve(moduleDir, relativePath)));
}
