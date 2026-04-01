import { test, expect } from "vitest";

import { throwOnFatalProtocolStderr } from "../../../src/agda/protocol-errors.js";

test("throwOnFatalProtocolStderr ignores benign stderr notices", () => {
  expect(() => {
    throwOnFatalProtocolStderr([
      { kind: "StderrOutput", text: "compiling..." },
      { kind: "StderrOutput", text: "warning: note" },
    ]);
  }).not.toThrow();
});

test("throwOnFatalProtocolStderr throws on parse/read failures", () => {
  expect(() => {
    throwOnFatalProtocolStderr([
      { kind: "StderrOutput", text: "cannot read: IOTCM ..." },
    ]);
  }).toThrow(/cannot read:/i);
});
