import { test, expect } from "vitest";

import { decodeProcessControlResponses } from "../../../src/protocol/responses/process-controls.js";

test("decodeProcessControlResponses collects display/running/stderr messages", () => {
  const decoded = decodeProcessControlResponses([
    { kind: "DisplayInfo", info: { kind: "Generic", message: "display" } },
    { kind: "RunningInfo", message: "running" },
    { kind: "StderrOutput", text: "warn" },
  ]);

  expect(decoded.messages).toEqual(["display", "running", "warn"]);
});

test("decodeProcessControlResponses reads status booleans", () => {
  const decoded = decodeProcessControlResponses([
    {
      kind: "Status",
      status: {
        checked: true,
        showImplicitArguments: false,
        showIrrelevantArguments: true,
      },
    },
  ]);

  expect(decoded.state.checked).toBe(true);
  expect(decoded.state.showImplicitArguments).toBe(false);
  expect(decoded.state.showIrrelevantArguments).toBe(true);
});
