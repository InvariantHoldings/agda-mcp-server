import { mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function walkJsonFiles(rootDir, currentDir = rootDir) {
  const files = [];

  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const entryPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(rootDir, entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }

  return files;
}

export function copyJsonAssets(sourceRoot, destRoot) {
  const absoluteSourceRoot = resolve(sourceRoot);
  const absoluteDestRoot = resolve(destRoot);

  for (const sourceFile of walkJsonFiles(absoluteSourceRoot)) {
    const relativePath = relative(absoluteSourceRoot, sourceFile);
    const destFile = join(absoluteDestRoot, relativePath);
    mkdirSync(dirname(destFile), { recursive: true });
    copyFileSync(sourceFile, destFile);
  }
}

export function scriptMain(argv = process.argv.slice(2)) {
  const [sourceRoot = "src", destRoot = "dist"] = argv;
  copyJsonAssets(sourceRoot, destRoot);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] === modulePath) {
  scriptMain();
}
