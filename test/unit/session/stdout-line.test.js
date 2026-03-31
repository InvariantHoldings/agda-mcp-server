import test from "node:test";
import assert from "node:assert/strict";

import { parseAgdaStdoutLine } from "../../../dist/session/stdout-line.js";

test("parseAgdaStdoutLine extracts JSON after a JSON prompt prefix", () => {
  const parsed = parseAgdaStdoutLine('JSON> {"kind":"Status"}');

  assert.deepEqual(parsed, { jsonText: '{"kind":"Status"}' });
});

test("parseAgdaStdoutLine turns prompt notices into notice text", () => {
  const parsed = parseAgdaStdoutLine("JSON> cannot read: IOTCM ...");

  assert.deepEqual(parsed, { noticeText: "cannot read: IOTCM ..." });
});

test("parseAgdaStdoutLine ignores empty prompt-only lines", () => {
  const parsed = parseAgdaStdoutLine("JSON> ");

  assert.deepEqual(parsed, {});
});
