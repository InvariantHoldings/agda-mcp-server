// MIT License — see LICENSE
//
// Regression fence for issue #10: "no new ad hoc command string
// assembly in tool-facing code".
//
// All Agda IOTCM commands must be constructed through the typed
// builders in `src/protocol/command-builder.ts`. This suite scans the
// production sources and fails if any module outside the builder
// itself either:
//   (a) Assembles the IOTCM transport envelope by hand (matching
//       `IOTCM "..." NonInteractive Direct (...)`), or
//   (b) Passes a bare-string Cmd_/Toggle/Show command literal into a
//       call that ships it to Agda — directly via `sendCommand` /
//       `iotcm` / `iotcmFor` / `buildIotcm` / `runIndependentCommand`
//       / `runControl`, or via the host-supplied `buildIotcm` field
//       used in `agda-version-detection.ts`.
//
// New commands that need a literal name still go through the builder
// — `topLevelCommand("Cmd_show_version")` is fine, the bare string
// `"Cmd_show_version"` is not.
//
// The scan operates on whole-file content (with comments stripped)
// so multi-line calls cannot smuggle a bare literal past a per-line
// regex. Comment stripping handles both `//` line comments and
// `/* … */` block comments so a documentation example doesn't
// false-positive the suite.

import { test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC_ROOT = resolve(import.meta.dirname, "..", "..", "..", "src");
const BUILDER_PATH = resolve(SRC_ROOT, "protocol", "command-builder.ts");

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

// Strip line and block comments from a TypeScript source so the
// downstream scan doesn't false-positive on documentation examples.
//
// The string-literal-aware version is overkill for this suite — a
// deliberately constructed string that splices a block-comment closer
// inside a string literal is not a realistic regression we need to
// defend against, and the conservative regex approach keeps the test
// cheap and easy to reason about.
function stripComments(source: string): string {
  // Block comments first so `// /* */` inside a line comment doesn't
  // confuse the line-comment pass.
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//gu, " ");
  // Line comments: keep newlines so reported positions stay sane and
  // multi-line spans don't accidentally collapse.
  return noBlock.replace(/(^|[^:"'`/])\/\/[^\n]*/gu, (_, lead: string) => lead);
}

interface Offender {
  file: string;
  index: number;
  rule: string;
  excerpt: string;
}

function locate(file: string, body: string, index: number, length: number): Offender {
  const start = Math.max(0, index - 24);
  const excerpt = body.slice(start, index + length + 24).replace(/\s+/gu, " ").trim();
  return {
    file: file.slice(SRC_ROOT.length + 1),
    index,
    rule: "",
    excerpt,
  };
}

function scan(
  files: string[],
  rule: string,
  pattern: RegExp,
): Offender[] {
  const offenders: Offender[] = [];
  for (const file of files) {
    if (file === BUILDER_PATH) continue;
    const stripped = stripComments(readFileSync(file, "utf8"));
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stripped)) !== null) {
      offenders.push({ ...locate(file, stripped, match.index, match[0].length), rule });
      // Advance manually for zero-width safety on flag-only patterns.
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  }
  return offenders;
}

const sources = listSourceFiles(SRC_ROOT).filter((f) => statSync(f).isFile());

test("no source file outside command-builder.ts assembles the IOTCM envelope", () => {
  const offenders = scan(
    sources,
    "iotcm-envelope-template",
    // Whole-file scan with /s so a multi-line template literal that
    // happens to put the path on one line and the command on the next
    // still trips the fence.
    /IOTCM\s+"[^"]*"\s+NonInteractive\s+Direct/gsu,
  );
  expect(offenders).toEqual([]);
});

test("no source file passes a bare Cmd_/Toggle/Show string into Agda dispatch points", () => {
  // Any call that ultimately ships a string to Agda — direct or via a
  // helper wrapper. Each pattern matches across newlines so a call
  // like `iotcm(\n  "Cmd_show_version"\n)` cannot evade the fence by
  // breaking the literal across lines.
  const dispatchPatterns: Array<{ rule: string; rx: RegExp }> = [
    {
      rule: "iotcm-bare-command",
      rx: /\b(?:iotcm|iotcmFor|buildIotcm)\s*\(\s*(?:"[^"\n]*"\s*,\s*)?"(Cmd_[A-Za-z_]*|Toggle[A-Za-z]*|Show[A-Za-z]*)"\s*[,)]/gsu,
    },
    {
      rule: "sendCommand-bare-command",
      rx: /\bsendCommand\s*\(\s*"(Cmd_[A-Za-z_]*|Toggle[A-Za-z]*|Show[A-Za-z]*)"/gsu,
    },
    {
      rule: "runControl-bare-command",
      rx: /\brunControl\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*"(Cmd_[A-Za-z_]*|Toggle[A-Za-z]*|Show[A-Za-z]*)"/gsu,
    },
    {
      rule: "runIndependentCommand-bare-command",
      rx: /\brunIndependentCommand\s*\(\s*"(Cmd_[A-Za-z_]*|Toggle[A-Za-z]*|Show[A-Za-z]*)"/gsu,
    },
  ];

  const offenders: Offender[] = [];
  for (const { rule, rx } of dispatchPatterns) {
    offenders.push(...scan(sources, rule, rx));
  }
  expect(offenders).toEqual([]);
});

test("the regression-fence ran against the real source tree", () => {
  // Sanity check — without this guard, a refactor that moves `src/`
  // could turn the suite into vacuous truth (zero files scanned ⇒
  // every assertion above passes).
  expect(sources.length).toBeGreaterThan(20);
  expect(sources.some((f) => f.endsWith("/protocol/command-builder.ts"))).toBeTruthy();
});

test("stripComments removes block- and line-comment regression fixtures", () => {
  // The fence only works if its comment-stripping recognizes both
  // `//` and `/* … */` forms. Pin both behaviours so a future
  // refactor can't silently revert to a line-only stripper.
  const blockExample = `
    /*
     * Documentation example: IOTCM "f.agda" NonInteractive Direct (Cmd_load "f.agda" [])
     */
    function f() {}
  `;
  const lineExample = `
    // iotcm("Cmd_show_version")
    function g() {}
  `;
  expect(stripComments(blockExample)).not.toContain("IOTCM");
  expect(stripComments(lineExample)).not.toContain("Cmd_show_version");
});
