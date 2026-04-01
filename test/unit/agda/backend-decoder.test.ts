import { test, expect } from "vitest";

import { decodeBackendResponses } from "../../../src/protocol/responses/backend.js";

test("decodeBackendResponses marks error DisplayInfo as failure", () => {
  const decoded = decodeBackendResponses([
    { kind: "DisplayInfo", info: { kind: "Error", message: "compile failed" } },
  ]);

  expect(decoded.success).toBe(false);
  expect(decoded.output).toBe("compile failed");
});

test("decodeBackendResponses includes running/stderr lines", () => {
  const decoded = decodeBackendResponses([
    { kind: "RunningInfo", message: "compiling" },
    { kind: "StderrOutput", text: "warning: note" },
  ]);

  expect(decoded.success).toBe(true);
  expect(decoded.output).toBe("compiling\nwarning: note");
});
