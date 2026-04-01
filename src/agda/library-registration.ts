// MIT License — see LICENSE
//
// Single source of truth for Agda library registration.
//
// Both stateful sessions and disposable batch sessions should derive the
// same AGDA_DIR and active library list from here so library resolution
// cannot drift across code paths.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

interface RegisteredLibrary {
  name: string;
  filePath: string;
}

export interface LibraryRegistration {
  agdaArgs: string[];
  agdaDir: string;
  cleanup(): void;
}

function readNonCommentLines(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [];
  }

  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
}

export function parseAgdaLibraryName(contents: string): string | null {
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("--")) {
      continue;
    }

    const match = /^name\s*:\s*(.+)$/u.exec(line);
    if (match) {
      const name = match[1].replace(/\s*--.*$/u, "").trim();
      return name || null;
    }
  }

  return null;
}

function readAgdaLibraryName(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return parseAgdaLibraryName(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readConfiguredLibraries(appDir: string): RegisteredLibrary[] {
  const librariesFile = join(appDir, "libraries");
  const librariesDir = dirname(librariesFile);
  const seenPaths = new Set<string>();
  const libraries: RegisteredLibrary[] = [];

  for (const line of readNonCommentLines(librariesFile)) {
    const filePath = resolve(librariesDir, line);
    if (!existsSync(filePath) || seenPaths.has(filePath)) {
      continue;
    }

    const name = readAgdaLibraryName(filePath);
    if (!name) {
      continue;
    }

    seenPaths.add(filePath);
    libraries.push({ name, filePath });
  }

  return libraries;
}

function discoverProjectLibraries(repoRoot: string): RegisteredLibrary[] {
  const seenPaths = new Set<string>();
  const libraries: RegisteredLibrary[] = [];

  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".agda-lib")) {
      continue;
    }

    const filePath = resolve(repoRoot, entry.name);
    if (seenPaths.has(filePath)) {
      continue;
    }

    const name = readAgdaLibraryName(filePath);
    if (!name) {
      continue;
    }

    seenPaths.add(filePath);
    libraries.push({ name, filePath });
  }

  return libraries.sort((left, right) => left.name.localeCompare(right.name));
}

function buildDefaults(appDir: string, knownLibraryNames: Set<string>): string[] {
  const defaultsFile = join(appDir, "defaults");
  const seenNames = new Set<string>();
  const defaults: string[] = [];

  for (const line of readNonCommentLines(defaultsFile)) {
    if (!knownLibraryNames.has(line) || seenNames.has(line)) {
      continue;
    }

    seenNames.add(line);
    defaults.push(line);
  }

  return defaults;
}

function writeConfigFile(filePath: string, lines: string[]): void {
  const output = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  writeFileSync(filePath, output, "utf8");
}

function uniqueLibraries(libraries: RegisteredLibrary[]): RegisteredLibrary[] {
  const seenPaths = new Set<string>();
  const unique: RegisteredLibrary[] = [];

  for (const library of libraries) {
    if (seenPaths.has(library.filePath)) {
      continue;
    }

    seenPaths.add(library.filePath);
    unique.push(library);
  }

  return unique;
}

function resolveAgdaAppDir(): string {
  return process.env.AGDA_DIR ?? join(homedir(), ".agda");
}

export function createLibraryRegistration(repoRoot: string): LibraryRegistration {
  const sourceAgdaDir = resolveAgdaAppDir();
  const configuredLibraries = readConfiguredLibraries(sourceAgdaDir);
  const projectLibraries = discoverProjectLibraries(repoRoot);
  const libraries = uniqueLibraries([...configuredLibraries, ...projectLibraries]);
  const knownLibraryNames = new Set(libraries.map((library) => library.name));
  const defaults = buildDefaults(sourceAgdaDir, knownLibraryNames);

  const agdaDir = mkdtempSync(join(tmpdir(), "agda-mcp-libs-"));
  writeConfigFile(join(agdaDir, "libraries"), libraries.map((library) => library.filePath));
  writeConfigFile(join(agdaDir, "defaults"), defaults);

  return {
    agdaArgs: projectLibraries.flatMap((library) => ["-l", library.name]),
    agdaDir,
    cleanup() {
      rmSync(agdaDir, { recursive: true, force: true });
    },
  };
}

export function projectLibraryNames(repoRoot: string): string[] {
  return discoverProjectLibraries(repoRoot).map((library) => library.name);
}

export function configuredLibraryFileNames(appDir: string): string[] {
  return readConfiguredLibraries(appDir).map((library) => basename(library.filePath));
}
