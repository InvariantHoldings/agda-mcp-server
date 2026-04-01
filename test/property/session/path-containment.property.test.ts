import { test, expect } from "vitest";
import { resolve, join, sep } from "node:path";

import { fc } from "@fast-check/vitest";

import { resolveFileWithinRoot } from "../../../src/repo-root.js";

const ROOT = "/repo/project";

test("resolveFileWithinRoot result always starts with root when it succeeds", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.stringMatching(/^[a-zA-Z0-9_.-]+$/), { minLength: 1, maxLength: 5 }),
      (segments) => {
        const path = join(...segments);
        const normalizedRoot = resolve(ROOT);
        let result;
        try {
          result = resolveFileWithinRoot(ROOT, path);
        } catch {
          // Escaping root is valid — no further assertion needed for that case
          return;
        }
        expect(
          result === normalizedRoot || result.startsWith(normalizedRoot + sep),
        ).toBeTruthy();
      },
    ),
  );
});

test("resolveFileWithinRoot paths with leading .. always escape the root", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.stringMatching(/^[a-zA-Z0-9_.-]+$/), { minLength: 0, maxLength: 3 }),
      (segments) => {
        // Prepend ".." to guarantee we try to escape at least one level
        const path = join("..", ...segments);
        expect(
          () => resolveFileWithinRoot(ROOT, path),
        ).toThrow(/escapes project root/);
      },
    ),
  );
});

test("resolveFileWithinRoot absolute paths outside root always throw", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.stringMatching(/^[a-zA-Z0-9_.-]+$/), { minLength: 1, maxLength: 3 }),
      (segments) => {
        // Build an absolute path outside ROOT (using /tmp as a different tree)
        const path = "/" + join("tmp", ...segments);
        // Only test if the path is genuinely outside ROOT
        if (!path.startsWith(resolve(ROOT) + sep) && path !== resolve(ROOT)) {
          expect(
            () => resolveFileWithinRoot(ROOT, path),
          ).toThrow(/escapes project root/);
        }
      },
    ),
  );
});
