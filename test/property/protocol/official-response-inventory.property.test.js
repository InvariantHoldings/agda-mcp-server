import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  listOfficialDisplayInfoKinds,
  listOfficialGoalDisplayInfoKinds,
  listOfficialResponseKinds,
} from "../../../dist/protocol/official-response-inventory.js";

test("official response inventory families are unique", async () => {
  await fc.assert(
    fc.asyncProperty(fc.constant(null), async () => {
      const responseKinds = listOfficialResponseKinds();
      const displayKinds = listOfficialDisplayInfoKinds();
      const goalKinds = listOfficialGoalDisplayInfoKinds();

      assert.equal(new Set(responseKinds).size, responseKinds.length);
      assert.equal(new Set(displayKinds).size, displayKinds.length);
      assert.equal(new Set(goalKinds).size, goalKinds.length);
    }),
  );
});
