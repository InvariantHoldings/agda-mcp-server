// MIT License — see LICENSE
//
// Property-based invariants for the typed IOTCM command builder.
//
// These cover the structural guarantees that issue #10 asks for:
//   - escaping invariants for `quoted` (no raw newlines, all `"` escaped)
//   - shape invariants for goal-scoped builders (`noRange` placement)
//   - stability of `iotcmEnvelope` wrapping arbitrary inner commands

import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import {
  boolLiteral,
  command,
  goalCommand,
  iotcmEnvelope,
  modeGoalCommand,
  rewriteGoalCommand,
  quoted,
  stringList,
  topLevelCommand,
} from "../../../src/protocol/command-builder.js";

test("quoted strips raw newlines and escapes every embedded quote", async () => {
  await fc.assert(
    fc.property(fc.string(), (raw) => {
      const rendered = quoted(raw);
      expect(rendered.startsWith('"')).toBeTruthy();
      expect(rendered.endsWith('"')).toBeTruthy();

      const inner = rendered.slice(1, -1);
      expect(!inner.includes("\n")).toBeTruthy();

      // Every `"` in the inner payload must be preceded by a backslash —
      // otherwise the IOTCM envelope would close prematurely.
      for (let index = 0; index < inner.length; index += 1) {
        if (inner[index] === '"') {
          expect(index > 0 && inner[index - 1] === "\\").toBeTruthy();
        }
      }
    }),
  );
});

test("stringList renders [] for empty and quoted entries otherwise", async () => {
  await fc.assert(
    fc.property(fc.array(fc.string(), { maxLength: 6 }), (values) => {
      const rendered = stringList(values);
      if (values.length === 0) {
        expect(rendered).toBe("[]");
        return;
      }
      expect(rendered.startsWith("[")).toBeTruthy();
      expect(rendered.endsWith("]")).toBeTruthy();
      // Every entry round-trips through `quoted` and is comma-joined.
      const expected = `[${values.map(quoted).join(", ")}]`;
      expect(rendered).toBe(expected);
    }),
  );
});

test("boolLiteral always renders True or False", async () => {
  await fc.assert(
    fc.property(fc.boolean(), (value) => {
      const rendered = boolLiteral(value);
      expect(rendered === "True" || rendered === "False").toBeTruthy();
    }),
  );
});

test("goalCommand places the integer goal id followed by noRange", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 32 }).filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(s)),
      fc.integer({ min: 0, max: 1_000_000 }),
      (name, goalId) => {
        const rendered = goalCommand(name, goalId);
        const parts = rendered.split(" ");
        expect(parts[0]).toBe(name);
        expect(parts[1]).toBe(String(goalId));
        expect(parts[2]).toBe("noRange");
      },
    ),
  );
});

test("modeGoalCommand and rewriteGoalCommand keep goalId before noRange", async () => {
  await fc.assert(
    fc.property(
      fc.constantFrom("Cmd_infer", "Cmd_compute", "Cmd_goal_type", "Cmd_autoOne"),
      fc.constantFrom("Normalised", "Simplified", "Instantiated", "DefaultCompute"),
      fc.integer({ min: 0, max: 4096 }),
      (name, mode, goalId) => {
        const modeRendered = modeGoalCommand(name, mode, goalId);
        const modeParts = modeRendered.split(" ");
        expect(modeParts[0]).toBe(name);
        expect(modeParts[1]).toBe(mode);
        expect(modeParts[2]).toBe(String(goalId));
        expect(modeParts[3]).toBe("noRange");

        const rewriteRendered = rewriteGoalCommand(name, mode, goalId);
        // rewriteGoalCommand uses the same shape — `(name, rewrite, goalId, noRange, ...)`.
        const rewriteParts = rewriteRendered.split(" ");
        expect(rewriteParts[0]).toBe(name);
        expect(rewriteParts[1]).toBe(mode);
        expect(rewriteParts[2]).toBe(String(goalId));
        expect(rewriteParts[3]).toBe("noRange");
      },
    ),
  );
});

test("iotcmEnvelope wraps any inner command without altering its body", async () => {
  await fc.assert(
    fc.property(
      // Cover arbitrary file paths including ones with `"`, `\`, and `\n`
      // — the escape inside iotcmEnvelope must keep the envelope shape
      // well-formed for any string the OS could legitimately produce.
      fc.string({ maxLength: 80 }),
      fc.constantFrom(
        topLevelCommand("Cmd_show_version"),
        topLevelCommand("Cmd_abort"),
        command("Cmd_load", quoted("/x/y.agda"), "[]"),
        goalCommand("Cmd_make_case", 3, quoted("xs")),
      ),
      (path, inner) => {
        const envelope = iotcmEnvelope(path, inner);
        // Reconstruct the expected escaped path the same way `quoted`
        // does so an embedded `"` can't trick us into a vacuous match.
        const escapedPath = quoted(path);
        const prefix = `IOTCM ${escapedPath} NonInteractive Direct (`;
        expect(envelope.startsWith(prefix)).toBeTruthy();
        expect(envelope.endsWith(")")).toBeTruthy();
        // The inner command must appear verbatim inside the parentheses.
        const innerRendered = envelope.slice(prefix.length, -1);
        expect(innerRendered).toBe(inner);
        // The envelope must contain no raw newlines — they would
        // otherwise corrupt the line-delimited stdin transport.
        expect(envelope.includes("\n")).toBeFalsy();
      },
    ),
  );
});
