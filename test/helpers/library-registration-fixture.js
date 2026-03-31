import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

function writeFiles(root, files) {
  for (const file of files) {
    const path = join(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents, "utf8");
  }
}

export function materializeLibraryRegistrationScenario(scenario) {
  const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-lib-repo-"));
  const agdaDir = mkdtempSync(join(tmpdir(), "agda-mcp-lib-app-"));

  writeFiles(repoRoot, scenario.projectFiles);
  writeFiles(agdaDir, scenario.agdaDirFiles);

  return {
    repoRoot,
    agdaDir,
    cleanup() {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(agdaDir, { recursive: true, force: true });
    },
  };
}
