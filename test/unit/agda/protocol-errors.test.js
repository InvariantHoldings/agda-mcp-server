import test from "node:test";
import assert from "node:assert/strict";

import { throwOnFatalProtocolStderr } from "../../../dist/agda/protocol-errors.js";

test("throwOnFatalProtocolStderr ignores benign stderr notices", () => {
  assert.doesNotThrow(() => {
    throwOnFatalProtocolStderr([
      { kind: "StderrOutput", text: "compiling..." },
      { kind: "StderrOutput", text: "warning: note" },
    ]);
  });
});

test("throwOnFatalProtocolStderr throws on parse/read failures", () => {
  assert.throws(() => {
    throwOnFatalProtocolStderr([
      { kind: "StderrOutput", text: "cannot read: IOTCM ..." },
    ]);
  }, /cannot read:/i);
});
