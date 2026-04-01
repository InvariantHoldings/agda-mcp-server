import { test, expect } from "vitest";

import { parseAgdaStdoutLine } from "../../../src/session/stdout-line.js";

test("parseAgdaStdoutLine extracts JSON after a JSON prompt prefix", () => {
  const parsed = parseAgdaStdoutLine('JSON> {"kind":"Status"}');

  expect(parsed).toEqual({ jsonText: '{"kind":"Status"}' });
});

test("parseAgdaStdoutLine turns prompt notices into notice text", () => {
  const parsed = parseAgdaStdoutLine("JSON> cannot read: IOTCM ...");

  expect(parsed).toEqual({ noticeText: "cannot read: IOTCM ..." });
});

test("parseAgdaStdoutLine ignores empty prompt-only lines", () => {
  const parsed = parseAgdaStdoutLine("JSON> ");

  expect(parsed).toEqual({});
});
