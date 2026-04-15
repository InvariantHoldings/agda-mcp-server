import { test, expect } from "vitest";
import { existsSync } from "node:fs";

import { fc } from "@fast-check/vitest";

import { withIsolatedAgdaDir } from "../../helpers/isolated-agda-dir.js";

const noNulString = fc.string().filter((value) => !value.includes("\u0000"));
const previousAgdaDirArb = fc.option(noNulString, { nil: undefined });

test("withIsolatedAgdaDir restores AGDA_DIR and returns callback value", async () => {
  await fc.assert(
    fc.asyncProperty(previousAgdaDirArb, fc.integer(), async (previousAgdaDir, marker) => {
      const originalAgdaDir = process.env.AGDA_DIR;
      let observedAgdaDir: string | undefined;

      try {
        if (previousAgdaDir === undefined) {
          delete process.env.AGDA_DIR;
        } else {
          process.env.AGDA_DIR = previousAgdaDir;
        }

        const result = await withIsolatedAgdaDir(async (agdaDir) => {
          observedAgdaDir = agdaDir;
          expect(process.env.AGDA_DIR).toBe(agdaDir);
          expect(existsSync(agdaDir)).toBe(true);
          return marker;
        });

        expect(result).toBe(marker);
        expect(process.env.AGDA_DIR).toBe(previousAgdaDir);
        expect(observedAgdaDir).toBeDefined();
        expect(existsSync(observedAgdaDir!)).toBe(false);
      } finally {
        if (originalAgdaDir === undefined) {
          delete process.env.AGDA_DIR;
        } else {
          process.env.AGDA_DIR = originalAgdaDir;
        }
      }
    }),
  );
});

test("withIsolatedAgdaDir restores AGDA_DIR when callback throws", async () => {
  await fc.assert(
    fc.asyncProperty(previousAgdaDirArb, noNulString, async (previousAgdaDir, message) => {
      const originalAgdaDir = process.env.AGDA_DIR;
      let observedAgdaDir: string | undefined;

      try {
        if (previousAgdaDir === undefined) {
          delete process.env.AGDA_DIR;
        } else {
          process.env.AGDA_DIR = previousAgdaDir;
        }

        await expect(async () => {
          await withIsolatedAgdaDir(async (agdaDir) => {
            observedAgdaDir = agdaDir;
            expect(process.env.AGDA_DIR).toBe(agdaDir);
            expect(existsSync(agdaDir)).toBe(true);
            throw new Error(message);
          });
        }).rejects.toThrow(message);

        expect(process.env.AGDA_DIR).toBe(previousAgdaDir);
        expect(observedAgdaDir).toBeDefined();
        expect(existsSync(observedAgdaDir!)).toBe(false);
      } finally {
        if (originalAgdaDir === undefined) {
          delete process.env.AGDA_DIR;
        } else {
          process.env.AGDA_DIR = originalAgdaDir;
        }
      }
    }),
  );
});
