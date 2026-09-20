import { test, expect } from "vitest";
import type { ChildProcess } from "node:child_process";

import { AgdaTransport } from "../../../src/session/agda-transport.js";
import { decodeResponse } from "../../../src/session/response-frame-decoder.js";
import { parseLoadResponses } from "../../../src/agda/parse-load-responses.js";

function fakeProcess(write: () => void = () => {}): ChildProcess {
  return {
    stdin: { write },
    exitCode: null,
    signalCode: null,
    killed: false,
  } as unknown as ChildProcess;
}

test("ordinary command completion is the prompt, not an early Status", async () => {
  const transport = new AgdaTransport();
  const proc = fakeProcess(() => {
    transport.handleStdout(Buffer.from('{"kind":"Status","status":{"checked":false}}\n'));
  });
  transport.attachProcess(proc);
  transport.handleStdout(Buffer.from("JSON> "));

  let settled = false;
  const pending = transport.sendCommand(proc, "IOTCM command", 100).then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);

  transport.handleStdout(Buffer.from("JSON> "));
  await expect(pending).resolves.toEqual([
    { kind: "Status", status: { checked: false }, checked: false },
  ]);
});

test("an unframed control fallback retires before the next ordinary write", async () => {
  const transport = new AgdaTransport();
  const signals: Array<NodeJS.Signals | number | undefined> = [];
  const proc = {
    exitCode: null,
    signalCode: null,
    killed: false,
    stdin: { write() {} },
    kill(signal?: NodeJS.Signals | number) {
      signals.push(signal);
      this.killed = true;
      return true;
    },
    once() { return this; },
  } as unknown as ChildProcess;

  await transport.sendFireAndForgetCommand(proc, "IOTCM abort", {
    flushMs: 5,
    escalationMs: 0,
  });
  await expect(transport.sendCommand(proc, "IOTCM ordinary", 100)).rejects.toThrow(
    /stream boundary; process retired/,
  );
  expect(signals).toContain("SIGTERM");
});

test("transport rejects a second ordinary request while one is outstanding", async () => {
  const transport = new AgdaTransport();
  const proc = fakeProcess();
  transport.attachProcess(proc);
  transport.handleStdout(Buffer.from("JSON> "));

  const first = transport.sendCommand(proc, "IOTCM first", 100);
  await expect(transport.sendCommand(proc, "IOTCM second", 100)).rejects.toThrow(
    /only one outstanding command/,
  );
  transport.handleProcessClose(proc, transport.processGeneration);
  await expect(first).rejects.toThrow(/closed before command prompt/);
});

test("process close rejects a frame even after apparently successful payloads", async () => {
  const transport = new AgdaTransport();
  const proc = fakeProcess(() => {
    transport.handleStdout(Buffer.from('{"kind":"Status","status":{"checked":true}}\n'));
  });
  transport.attachProcess(proc);
  transport.handleStdout(Buffer.from("JSON> "));

  const pending = transport.sendCommand(proc, "IOTCM command", 100);
  await Promise.resolve();
  transport.handleProcessClose(undefined, transport.processGeneration);

  await expect(pending).rejects.toThrow(/closed before command prompt/);
});

test("replacing a process rejects a command waiting on startup", async () => {
  const transport = new AgdaTransport();
  const first = fakeProcess();
  transport.attachProcess(first);
  const pending = transport.sendCommand(first, "IOTCM first", 100);
  const second = fakeProcess();
  const secondGeneration = transport.attachProcess(second);

  await expect(pending).rejects.toThrow(/replaced while waiting for startup/);
  transport.handleStdout(Buffer.from("JSON> "), secondGeneration);
  const next = transport.sendCommand(second, "IOTCM second", 100);
  transport.handleStdout(Buffer.from('{"kind":"Status"}\nJSON> '), secondGeneration);
  await expect(next).resolves.toEqual([{ kind: "Status" }]);
});

test("old process generations cannot complete or contaminate a new command", async () => {
  const transport = new AgdaTransport();
  const first = fakeProcess();
  const firstGeneration = transport.attachProcess(first);
  transport.handleStdout(Buffer.from("JSON> "));
  const second = fakeProcess(() => {
    transport.handleStdout(Buffer.from('{"kind":"Status"}\nJSON> '));
  });
  const secondGeneration = transport.attachProcess(second);
  expect(secondGeneration).not.toBe(firstGeneration);

  transport.handleStdout(Buffer.from('{"kind":"DisplayInfo"}\nJSON> '), firstGeneration);
  const pending = transport.sendCommand(second, "IOTCM command", 100);
  transport.handleStdout(Buffer.from("JSON> "), secondGeneration);
  await expect(pending).resolves.toEqual([{ kind: "Status" }]);
});

test("response decoding rejects malformed AllGoalsWarnings before normalization", () => {
  const missingArrays = {
    kind: "DisplayInfo",
    info: { kind: "AllGoalsWarnings" },
  };
  const wrongVisibleGoals = {
    kind: "DisplayInfo",
    info: {
      kind: "AllGoalsWarnings",
      visibleGoals: "not an array",
      invisibleGoals: [],
      errors: [],
      warnings: [],
    },
  };

  expect(() => decodeResponse(JSON.stringify(missingArrays))).toThrow(/AllGoalsWarnings/);
  expect(() => decodeResponse(JSON.stringify(wrongVisibleGoals))).toThrow(/AllGoalsWarnings/);
});

test("load parsing fails closed for malformed AllGoalsWarnings evidence", () => {
  const malformed = [
    { kind: "DisplayInfo", info: { kind: "AllGoalsWarnings" } },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: "not an array",
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ];

  for (const response of malformed) {
    const result = parseLoadResponses([response as any], { frameComplete: true });
    expect(result.success).toBe(false);
    expect(result.classification).toBe("protocol-error");
  }
});

test("explicit DisplayInfo Error blocks success even when its payload is malformed", () => {
  const result = parseLoadResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
    { kind: "DisplayInfo", info: { kind: "Error", error: "late type error" } },
  ], { frameComplete: true });

  expect(result.success).toBe(false);
  expect(result.classification).toBe("type-error");
});

test("no-metas DisplayInfo Error cannot certify an empty load", () => {
  const result = parseLoadResponses([
    { kind: "DisplayInfo", info: { kind: "Error", error: "late type error" } },
  ], { mode: "load-no-metas", frameComplete: true });

  expect(result.success).toBe(false);
});

test("startup DisplayInfo Error rejects a command waiting for readiness", async () => {
  const transport = new AgdaTransport();
  const proc = fakeProcess();
  const generation = transport.attachProcess(proc);
  const pending = transport.sendCommand(proc, "IOTCM command", 100);

  transport.handleStdout(Buffer.from(
    '{"kind":"DisplayInfo","info":{"kind":"Error","error":"setup failed"}}\nJSON> ',
  ), generation);

  await expect(pending).rejects.toThrow(/setup failed/);
});

test("control readiness is bounded when startup never produces a prompt", async () => {
  const transport = new AgdaTransport();
  const proc = fakeProcess();
  transport.attachProcess(proc);

  await expect(transport.sendFireAndForgetCommand(proc, "IOTCM abort", {
    startupTimeoutMs: 10,
    flushMs: 5,
    escalationMs: 0,
  })).resolves.toEqual([]);
});

test("load parsing fails closed without successful-load evidence", () => {
  expect(parseLoadResponses([]).success).toBe(false);
  expect(parseLoadResponses([]).classification).toBe("protocol-error");
  expect(parseLoadResponses([{ kind: "Status", checked: true }]).success).toBe(false);
  expect(parseLoadResponses([{ kind: "Status", checked: true }]).classification).toBe("protocol-error");
});

test("load parsing rejects an unsealed frame even when payload evidence exists", () => {
  const result = parseLoadResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ], { mode: "load", frameComplete: false });
  expect(result.success).toBe(false);
  expect(result.classification).toBe("protocol-error");
});

test("load-no-metas mode can certify a prompt-completed empty frame", () => {
  const result = parseLoadResponses([], {
    mode: "load-no-metas",
    frameComplete: true,
  });
  expect(result.success).toBe(true);
  expect(result.classification).toBe("ok-complete");
});
