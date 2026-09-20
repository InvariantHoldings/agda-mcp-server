import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import { AgdaStdoutFramer } from "../../../src/session/stdout-framer.js";

test("framer recognizes a prompt without a newline and adjacent JSON", () => {
  const framer = new AgdaStdoutFramer();

  expect(framer.push(Buffer.from("JSON> "))).toEqual([
    { type: "prompt", value: "JSON> " },
  ]);
  expect(framer.push(Buffer.from('{"kind":"Status"}\nJSON> '))).toEqual([
    { type: "json", text: '{"kind":"Status"}' },
    { type: "prompt", value: "JSON> " },
  ]);
});

test("framer preserves prompt-looking text inside a JSON string", () => {
  const framer = new AgdaStdoutFramer();
  const line = '{"kind":"DisplayInfo","message":"JSON> not a delimiter"}\n';

  expect(framer.push(Buffer.from(line))).toEqual([
    { type: "json", text: line.trim() },
  ]);
});

test("framer handles every UTF-8 byte split without changing events", () => {
  const bytes = Buffer.from(
    'JSON> {"kind":"DisplayInfo","message":"λ 🚀"}\nJSON> ',
    "utf8",
  );
  const expected = [
    { type: "prompt", value: "JSON> " },
    { type: "json", text: '{"kind":"DisplayInfo","message":"λ 🚀"}' },
    { type: "prompt", value: "JSON> " },
  ];

  fc.assert(
    fc.property(fc.integer({ min: 0, max: bytes.length }), (split) => {
      const framer = new AgdaStdoutFramer();
      const events = [
        ...framer.push(bytes.subarray(0, split)),
        ...framer.push(bytes.subarray(split)),
      ];
      expect(events).toEqual(expected);
    }),
  );
});

test("framer reports malformed JSON and raw diagnostics instead of dropping them", () => {
  const framer = new AgdaStdoutFramer();

  expect(framer.push(Buffer.from('{"kind":}\nwarning from Agda\nJSON> '))).toEqual([
    { type: "malformed", text: '{"kind":}' },
    { type: "raw", text: "warning from Agda" },
    { type: "prompt", value: "JSON> " },
  ]);
});

test("a legitimate U+FFFD in valid JSON is not reported as malformed", () => {
  const framer = new AgdaStdoutFramer();
  const events = framer.push(Buffer.from(
    '{"kind":"DisplayInfo","message":"�"}\nJSON> ',
    "utf8",
  ));

  expect(events).toEqual([
    { type: "json", text: '{"kind":"DisplayInfo","message":"�"}' },
    { type: "prompt", value: "JSON> " },
  ]);
  expect(framer.finish()).toEqual([]);
});

test("an invalid UTF-8 byte before a prompt is reported immediately", () => {
  const framer = new AgdaStdoutFramer();
  const input = Buffer.concat([
    Buffer.from('{"kind":"Status","message":"'),
    Buffer.from([0xe2]),
    Buffer.from('"}\nJSON> '),
  ]);

  expect(framer.push(input)).toEqual([
    { type: "malformed", text: "Invalid UTF-8 in Agda stdout" },
  ]);
});

test("invalid UTF-8 fails closed for every chunk split", () => {
  const bytes = Buffer.concat([
    Buffer.from('{"kind":"Status","message":"'),
    Buffer.from([0xe2]),
    Buffer.from('"}\nJSON> '),
  ]);

  fc.assert(
    fc.property(fc.integer({ min: 0, max: bytes.length }), (split) => {
      const framer = new AgdaStdoutFramer();
      const events = [
        ...framer.push(bytes.subarray(0, split)),
        ...framer.push(bytes.subarray(split)),
      ];
      expect(events.some((event) => event.type === "malformed")).toBe(true);
      expect(events.some((event) => event.type === "json")).toBe(false);
    }),
  );
});

test("reset starts a fresh UTF-8 decoder after a truncated sequence", () => {
  const framer = new AgdaStdoutFramer();
  expect(framer.push(Buffer.from([0xe2]))).toEqual([]);
  framer.reset();

  expect(framer.push(Buffer.from("JSON> "))).toEqual([
    { type: "prompt", value: "JSON> " },
  ]);
});

test("finish reports a truncated UTF-8 sequence", () => {
  const framer = new AgdaStdoutFramer();
  framer.push(Buffer.from([0xe2]));

  expect(framer.finish()).toEqual([
    { type: "malformed", text: "Invalid UTF-8 in Agda stdout" },
  ]);
});
