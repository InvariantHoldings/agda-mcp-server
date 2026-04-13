import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import { findGoalPositions } from "../../../src/session/goal-positions.js";

test("findGoalPositions never throws for arbitrary input", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (source) => {
      expect(() => findGoalPositions(source)).not.toThrow();
    }),
  );
});

test("every returned position has valid offsets within source bounds", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (source) => {
      const positions = findGoalPositions(source);
      for (const pos of positions) {
        expect(pos.startOffset).toBeGreaterThanOrEqual(0);
        expect(pos.endOffset).toBeGreaterThan(pos.startOffset);
        expect(pos.endOffset).toBeLessThanOrEqual(source.length);
        expect(pos.line).toBeGreaterThanOrEqual(0);
        expect(pos.column).toBeGreaterThanOrEqual(0);
      }
    }),
  );
});

test("markerText matches the source slice at the reported offsets", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (source) => {
      const positions = findGoalPositions(source);
      for (const pos of positions) {
        expect(pos.markerText).toBe(source.slice(pos.startOffset, pos.endOffset));
      }
    }),
  );
});

test("positions are returned in strictly increasing offset order", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (source) => {
      const positions = findGoalPositions(source);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i].startOffset).toBeGreaterThan(
          positions[i - 1].endOffset - 1,
        );
      }
    }),
  );
});

test("every {!!} in source without comments is found", async () => {
  // Generate simple sources: alphanumeric parts joined by {!!}
  const simpleIdent = fc
    .string({ minLength: 1, maxLength: 20 })
    .filter((s) => /^[a-z0-9_ ]+$/.test(s));

  await fc.assert(
    fc.asyncProperty(
      fc.array(simpleIdent, { minLength: 2, maxLength: 5 }),
      async (parts) => {
        const source = parts.join("{!!}");
        const positions = findGoalPositions(source);
        // Number of holes = number of {!!} separators = parts.length - 1
        expect(positions).toHaveLength(parts.length - 1);
        for (const pos of positions) {
          expect(pos.markerText).toBe("{!!}");
        }
      },
    ),
  );
});

test("replacing a found hole produces a valid string", async () => {
  // Verify that hole positions allow valid string splicing
  const sourceWithHole = fc.constantFrom(
    "x = {!!}",
    "a = {!!}\nb = {!!}",
    "f x = {! x !}",
    "q = ?",
    "a = ?\nb = {!!}",
  );

  const replacement = fc
    .string({ minLength: 1, maxLength: 10 })
    .filter((s) => /^[a-z]+$/.test(s));

  await fc.assert(
    fc.asyncProperty(sourceWithHole, replacement, async (source, repl) => {
      const positions = findGoalPositions(source);
      expect(positions.length).toBeGreaterThan(0);

      const pos = positions[0];
      const result =
        source.slice(0, pos.startOffset) +
        repl +
        source.slice(pos.endOffset);

      // Replacement should not break the string
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }),
  );
});
