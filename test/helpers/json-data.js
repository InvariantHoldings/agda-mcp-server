import { readFileSync } from "node:fs";

export function loadJsonData(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
