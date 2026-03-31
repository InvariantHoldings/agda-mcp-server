import test from "node:test";
import assert from "node:assert/strict";

import { decodeDisplayInfoEvents } from "../../../dist/protocol/responses/display-info.js";

test("decodeDisplayInfoEvents reads structured Version.version payloads", () => {
  const events = decodeDisplayInfoEvents([
    {
      kind: "DisplayInfo",
      info: {
        kind: "Version",
        version: "2.7.0.1",
      },
    },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].infoKind, "Version");
  assert.equal(events[0].text, "2.7.0.1");
});
