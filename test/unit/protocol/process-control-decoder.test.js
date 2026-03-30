import test from "node:test";
import assert from "node:assert/strict";

import { decodeProcessControlResponses } from "../../../dist/protocol/responses/process-controls.js";

test("decodeProcessControlResponses collects display/running/stderr messages", () => {
  const decoded = decodeProcessControlResponses([
    { kind: "DisplayInfo", info: { kind: "Generic", message: "display" } },
    { kind: "RunningInfo", message: "running" },
    { kind: "StderrOutput", text: "warn" },
  ]);

  assert.deepEqual(decoded.messages, ["display", "running", "warn"]);
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

  assert.equal(decoded.state.checked, true);
  assert.equal(decoded.state.showImplicitArguments, false);
  assert.equal(decoded.state.showIrrelevantArguments, true);
});
