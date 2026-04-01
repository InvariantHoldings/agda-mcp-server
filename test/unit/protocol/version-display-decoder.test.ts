import { test, expect } from "vitest";

import { decodeDisplayInfoEvents } from "../../../src/protocol/responses/display-info.js";

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

  expect(events.length).toBe(1);
  expect(events[0].infoKind).toBe("Version");
  expect(events[0].text).toBe("2.7.0.1");
});
