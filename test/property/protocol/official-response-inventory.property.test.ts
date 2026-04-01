import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  listOfficialDisplayInfoKinds,
  listOfficialGoalDisplayInfoKinds,
  listOfficialResponseKinds,
  // @ts-expect-error tooling module lacks types
} from "../../../tooling/protocol/official-response-inventory.js";

test("official response inventory families are unique", async () => {
  await fc.assert(
    fc.asyncProperty(fc.constant(null), async () => {
      const responseKinds = listOfficialResponseKinds();
      const displayKinds = listOfficialDisplayInfoKinds();
      const goalKinds = listOfficialGoalDisplayInfoKinds();

      expect(new Set(responseKinds).size).toBe(responseKinds.length);
      expect(new Set(displayKinds).size).toBe(displayKinds.length);
      expect(new Set(goalKinds).size).toBe(goalKinds.length);
    }),
  );
});
