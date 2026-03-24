import test from "node:test";
import assert from "node:assert/strict";

import { decodeBackendResponses } from "../dist/protocol/responses/backend.js";

test("decodeBackendResponses marks error DisplayInfo as failure", () => {
  const decoded = decodeBackendResponses([
    { kind: "DisplayInfo", info: { kind: "Error", message: "compile failed" } },
  ]);

  assert.equal(decoded.success, false);
  assert.equal(decoded.output, "compile failed");
});

test("decodeBackendResponses includes running/stderr lines", () => {
  const decoded = decodeBackendResponses([
    { kind: "RunningInfo", message: "compiling" },
    { kind: "StderrOutput", text: "warning: note" },
  ]);

  assert.equal(decoded.success, true);
  assert.equal(decoded.output, "compiling\nwarning: note");
});
