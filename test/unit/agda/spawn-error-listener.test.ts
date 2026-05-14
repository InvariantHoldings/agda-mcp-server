// MIT License — see LICENSE
//
// Regression for Copilot review on PR #56 (round 6 /
// `agda-process-spawn.ts:126`). `spawnAgdaProcess` originally
// REMOVED the proc's `"error"` listener in `detachListeners`. If the
// abandoned child later emitted `error` (e.g. an async spawn
// failure from an invalid `AGDA_BIN` that races
// destroy/respawn), Node throws on the unhandled emitter event and
// crashes the server. The fix swaps the live handler for a quiet
// logger so the proc always has at least one `error` listener.
//
// We mock `node:child_process` and `binary-discovery` so this test
// runs without a real Agda binary. The mock returns an EventEmitter
// dressed up just enough to satisfy `spawnAgdaProcess`'s wire-up,
// then we assert the listener count on `"error"` is non-zero AFTER
// `detachListeners()` and that emitting `"error"` does not throw.

import { test, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

function makeFakeProc(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: () => void };
} {
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: () => void };
  };
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.stdin = { write: () => {} };
  return emitter;
}

const fakeProc = makeFakeProc();

vi.mock("node:child_process", () => ({
  spawn: () => fakeProc,
}));

vi.mock("../../../src/agda/binary-discovery.js", () => ({
  findAgdaBinary: () => "/fake/agda",
}));

test("spawnAgdaProcess.detachListeners keeps at least one 'error' listener so a late event from the abandoned child cannot crash Node", async () => {
  const { spawnAgdaProcess } = await import("../../../src/agda/agda-process-spawn.js");
  const { AgdaTransport } = await import("../../../src/session/agda-transport.js");

  const transport = new AgdaTransport();
  const { detachListeners } = spawnAgdaProcess({
    repoRoot: "/fake/repo",
    registration: { agdaDir: "/fake/dir", agdaArgs: [], cleanup: () => {} },
    transport,
    onClose: () => {},
    onError: () => {},
  });

  // Before detach: exactly one `error` listener — the transport-wired one.
  expect((fakeProc as unknown as ChildProcess).listenerCount("error")).toBe(1);

  detachListeners();

  // After detach: still at least one `error` listener — the no-op
  // logger replacement. Without the fix this would be zero and the
  // next line would crash the Node process.
  expect((fakeProc as unknown as ChildProcess).listenerCount("error")).toBeGreaterThanOrEqual(1);
  expect(() => (fakeProc as unknown as ChildProcess).emit("error", new Error("late spawn failure"))).not.toThrow();
});
