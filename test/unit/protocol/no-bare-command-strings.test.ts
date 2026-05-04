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
//       call that ships it to Agda (`ctx.iotcm("Cmd_…")`,
//       `runIndependentCommand("Cmd_…")`, `runControl(ctx, "…", …)`).
//
// New commands that need a literal name still go through the builder
// — `topLevelCommand("Cmd_show_version")` is fine, the bare string
// `"Cmd_show_version"` is not.

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

interface Offender {
  file: string;
  line: number;
  text: string;
  rule: string;
}

const sources = listSourceFiles(SRC_ROOT).filter((f) => statSync(f).isFile());

test("no source file outside command-builder.ts assembles the IOTCM envelope", () => {
  const offenders: Offender[] = [];
  // Match the literal envelope template — `IOTCM "..." NonInteractive Direct (...)`
  // (`.*` is fine for our purposes; we are scanning narrow-domain code).
  const envelopePattern = /IOTCM\s+"[^"]*"\s+NonInteractive\s+Direct/u;

  for (const file of sources) {
    if (file === BUILDER_PATH) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/u);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      // Ignore comments — references in jsdoc / inline notes are fine.
      if (/^\s*(\/\/|\*)/u.test(line)) continue;
      if (envelopePattern.test(line)) {
        offenders.push({
          file: file.slice(SRC_ROOT.length + 1),
          line: i + 1,
          text: line.trim(),
          rule: "iotcm-envelope-template",
        });
      }
    }
  }

  expect(offenders).toEqual([]);
});

test("no source file passes a bare Cmd_/Toggle/Show string into iotcm/sendCommand/runControl/runIndependentCommand", () => {
  const offenders: Offender[] = [];
  // Three call sites that ship strings to Agda — the inner argument
  // must be a builder-produced expression, not a string literal that
  // happens to start with a known Agda command prefix.
  const patterns: Array<{ rule: string; rx: RegExp }> = [
    {
      rule: "iotcm-bare-command",
      rx: /\biotcm\s*\(\s*"(Cmd_[A-Za-z_]*|Toggle[A-Za-z]*|Show[A-Za-z]*)"\s*[,)]/u,
    },
    {
      rule: "sendCommand-bare-command",
      rx: /\bsendCommand\s*\(\s*"(Cmd_[A-Za-z_]*|Toggle[A-Za-z]*|Show[A-Za-z]*)"/u,
    },
    {
      rule: "runControl-bare-command",
      rx: /\brunControl\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*"(Cmd_[A-Za-z_]*|Toggle[A-Za-z]*|Show[A-Za-z]*)"/u,
    },
    {
      rule: "runIndependentCommand-bare-command",
      rx: /\brunIndependentCommand\s*\(\s*"(Cmd_[A-Za-z_]*|Toggle[A-Za-z]*|Show[A-Za-z]*)"/u,
    },
  ];

  for (const file of sources) {
    if (file === BUILDER_PATH) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/u);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*(\/\/|\*)/u.test(line)) continue;
      for (const { rule, rx } of patterns) {
        if (rx.test(line)) {
          offenders.push({
            file: file.slice(SRC_ROOT.length + 1),
            line: i + 1,
            text: line.trim(),
            rule,
          });
        }
      }
    }
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
