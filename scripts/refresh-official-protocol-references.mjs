import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const metadataPath = join(repoRoot, "src", "protocol", "data", "official-reference-sources.json");
const defaultOutDir = join(repoRoot, ".local-reference", "agda-protocol");

function parseArgs(argv) {
  let outDir = defaultOutDir;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out-dir" && argv[index + 1]) {
      outDir = resolve(argv[index + 1]);
      index += 1;
    }
  }

  return { outDir };
}

async function main() {
  const { outDir } = parseArgs(process.argv.slice(2));
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));

  mkdirSync(outDir, { recursive: true });

  const manifest = {
    fetchedAt: new Date().toISOString(),
    outDir,
    sources: [],
  };

  for (const source of metadata.sources) {
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${source.url}: HTTP ${response.status}`);
    }

    const body = await response.text();
    const destination = join(outDir, source.filename);
    writeFileSync(destination, body, "utf8");
    manifest.sources.push({
      id: source.id,
      url: source.url,
      filename: source.filename,
      description: source.description,
    });
  }

  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Refreshed ${manifest.sources.length} official Agda reference file(s) into ${outDir}`);
}

await main();
