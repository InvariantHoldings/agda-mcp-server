import { resolve } from "node:path";
import { loadJsonData } from "../../helpers/json-data.js";

export const fixtureMatrix = loadJsonData(
  resolve(import.meta.dirname, "./fixture-matrix.json"),
);
