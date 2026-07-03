import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgdaSession } from "../../../src/agda-process.js";
import { detectAgdaVersion } from "../../helpers/agda-version.js";

const agdaAvailable = detectAgdaVersion() !== undefined;
const it = agdaAvailable && process.env.RUN_AGDA_INTEGRATION === "1" ? test : test.skip;

// Regression for the stale-dependency false-green (issues #61 / #64):
// load A (depends on B) clean, then break B on disk and reload A. A correct
// reload must rebuild B and surface the resulting error — never re-report the
// previous clean result. The pre-fix idle-completion path could resolve the
// reload before the dependency's rebuild error reached the wire, reporting a
// fabricated `ok-complete`. The goal-state terminus wait closes that gap.
//
// The dependency contains a deliberately slow, SILENT check (forced
// normalization of ack(3,8) against its literal numeral, so `refl` cannot
// short-circuit). That reproduces the actual race: Agda emits `Checking B`
// and then nothing for seconds while it rebuilds, which is exactly the gap
// the old idle heuristic mistook for completion. With the terminus wait the
// reload is correct regardless of how long that silent gap runs.

function acker(m: number, n: number): number {
  const memo = new Map<string, number>();
  const a = (x: number, y: number): number => {
    const k = `${x},${y}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const v = x === 0 ? y + 1 : y === 0 ? a(x - 1, 1) : a(x - 1, a(x, y - 1));
    memo.set(k, v);
    return v;
  };
  return a(m, n);
}
const nat = (n: number) => `${"suc (".repeat(n)}zero${")".repeat(n)}`;
const PRELUDE =
  "data Nat : Set where\n  zero : Nat\n  suc  : Nat -> Nat\n" +
  "ack : Nat -> Nat -> Nat\n" +
  "ack zero    b       = suc b\n" +
  "ack (suc a) zero    = ack a (suc zero)\n" +
  "ack (suc a) (suc b) = ack a (ack (suc a) b)\n" +
  "data _==_ {A : Set}(x : A) : A -> Set where\n  refl : x == x\n";
// A slow, silent normalization that passes — the rebuild spends seconds here.
const SLOW =
  `M : Nat\nM = ${nat(3)}\nN : Nat\nN = ${nat(8)}\nK : Nat\nK = ${nat(acker(3, 8))}\n` +
  "slow : ack M N == K\nslow = refl\n";

const B_OK = `module B where\n${PRELUDE}${SLOW}foo : Nat\nfoo = zero\n`;
// foo is retyped to Set, so A's `bar : Nat := foo` becomes ill-typed.
const B_BROKEN = `module B where\n${PRELUDE}${SLOW}foo : Set\nfoo = Nat\n`;
const A_SRC = `module A where

open import B

bar : Nat
bar = foo
`;

it("a broken dependency reloads as type-error, not a stale false-green", async () => {
  const root = mkdtempSync(join(tmpdir(), "stale-dep-"));
  const agdaDir = mkdtempSync(join(tmpdir(), "stale-dep-adir-"));
  writeFileSync(join(root, "B.agda"), B_OK);
  writeFileSync(join(root, "A.agda"), A_SRC);

  // Isolated, empty AGDA_DIR so no ambient ~/.agda libraries/defaults are
  // read — the two self-contained modules need none.
  const prevAgdaDir = process.env.AGDA_DIR;
  const prevAgdaBin = process.env.AGDA_BIN;
  process.env.AGDA_DIR = agdaDir;
  delete process.env.AGDA_BIN;

  const session = new AgdaSession(root);
  try {
    const baseline = await session.load("A.agda");
    expect(baseline.success).toBe(true);
    expect(baseline.classification).toBe("ok-complete");

    // Break B and push its mtime forward so the rebuild is unambiguous.
    writeFileSync(join(root, "B.agda"), B_BROKEN);
    const future = Date.now() / 1000 + 5;
    utimesSync(join(root, "B.agda"), future, future);

    const reload = await session.load("A.agda");
    expect(reload.success).toBe(false);
    expect(reload.classification).toBe("type-error");
    expect(reload.errors.length).toBeGreaterThan(0);
  } finally {
    await session.destroy();
    if (prevAgdaDir === undefined) delete process.env.AGDA_DIR;
    else process.env.AGDA_DIR = prevAgdaDir;
    if (prevAgdaBin !== undefined) process.env.AGDA_BIN = prevAgdaBin;
  }
}, 60_000);
