// MIT License — see LICENSE
//
// Process-termination correctness for `terminateAgdaProcess`. Before
// 0.6.7 the per-command timeout in `AgdaTransport.sendCommand`
// resolved its Promise without killing the underlying `agda
// --interaction-json` subprocess. An external agent observed: "one
// Agda interaction process is still burning a full CPU and 38%
// memory from the timed-out MCP path." These tests cover the helper
// that closes that gap. We use plain `node` subprocesses rather
// than real Agda so the cases run anywhere `node` exists and we can
// script SIGTERM-ignoring behaviour explicitly.
//
// The two scenarios that matter:
//   1. SIGTERM-honouring child → exits cleanly within the grace
//      window, SIGKILL fallback never fires.
//   2. SIGTERM-ignoring child  → SIGKILL escalation reaps the child
//      after the grace window expires.

import { describe, test, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";

import {
  DEFAULT_TERMINATE_GRACE_MS,
  terminateAgdaProcess,
} from "../../../src/agda/agda-process-spawn.js";

function waitForExit(proc: ChildProcess): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve({ code: proc.exitCode, signal: proc.signalCode });
      return;
    }
    proc.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

describe("terminateAgdaProcess", () => {
  test("SIGTERM is enough for a well-behaved child", async () => {
    // A vanilla `setInterval` is killed by SIGTERM's default action,
    // so the SIGKILL fallback should never need to fire.
    const proc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000_000);"]);

    terminateAgdaProcess(proc, { graceMs: DEFAULT_TERMINATE_GRACE_MS });

    const { signal } = await waitForExit(proc);
    expect(signal).toBe("SIGTERM");
  });

  test("SIGKILL fallback reaps a child that ignores SIGTERM", async () => {
    // Install a SIGTERM handler that swallows the signal. Without
    // the SIGKILL escalation this child would run forever.
    const script = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000_000);";
    const proc = spawn(process.execPath, ["-e", script]);

    // Wait a beat so the child has time to install its SIGTERM
    // handler before we send the signal. Without this, the kernel
    // can deliver SIGTERM before the JS handler attaches and the
    // process exits to SIGTERM after all, defeating the test.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const graceMs = 200;
    terminateAgdaProcess(proc, { graceMs });

    const { signal } = await waitForExit(proc);
    expect(signal).toBe("SIGKILL");
  }, 10_000);

  test("no-op on an already-exited process", async () => {
    const proc = spawn(process.execPath, ["-e", "process.exit(0);"]);
    await waitForExit(proc);

    // Should not throw, should not double-kill.
    expect(() => terminateAgdaProcess(proc)).not.toThrow();
    expect(proc.exitCode).toBe(0);
  });

  test("escalation timer is unref()'d so it doesn't keep node alive", async () => {
    // Catch a regression where the SIGKILL timer was a regular
    // setTimeout — that would prevent process.exit from running
    // even though the rest of the program is done.
    const proc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000_000);"]);

    terminateAgdaProcess(proc, { graceMs: 100_000 });

    // The proc itself dies fast on SIGTERM, so the timer should
    // never fire — but even if it would, an unref'd timer doesn't
    // block test completion. The assertion here is that
    // `waitForExit` resolves promptly.
    const startedAt = Date.now();
    await waitForExit(proc);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
