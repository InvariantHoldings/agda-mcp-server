// Re-export from the canonical src/ module so tests and production
// code share a single implementation.
export type { AgdaVersion } from "../../src/agda/agda-version.js";
export {
  parseAgdaVersion,
  compareVersions,
  versionAtLeast,
  detectAgdaVersion,
  formatVersion,
} from "../../src/agda/agda-version.js";
