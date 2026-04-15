import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Run a callback with an isolated, empty AGDA_DIR and restore the prior
 * process value afterwards.
 */
export async function withIsolatedAgdaDir<T>(
  run: (agdaDir: string) => Promise<T> | T,
): Promise<T> {
  const previousAgdaDir = process.env.AGDA_DIR;
  const agdaDir = mkdtempSync(join(tmpdir(), "agda-mcp-test-agda-dir-"));

  writeFileSync(join(agdaDir, "libraries"), "", "utf8");
  writeFileSync(join(agdaDir, "defaults"), "", "utf8");
  process.env.AGDA_DIR = agdaDir;

  try {
    return await run(agdaDir);
  } finally {
    if (previousAgdaDir === undefined) {
      delete process.env.AGDA_DIR;
    } else {
      process.env.AGDA_DIR = previousAgdaDir;
    }
    rmSync(agdaDir, { recursive: true, force: true });
  }
}
