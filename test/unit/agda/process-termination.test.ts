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
// The scenarios that matter:
//   1. SIGTERM-honouring child  → exits cleanly within the grace
//      window, SIGKILL fallback never fires.
//   2. SIGTERM-ignoring child   → SIGKILL escalation reaps the
//      child after the grace window expires.
//   3. Already-exited process   → idempotent no-op.
//   4. Escalation timer        → `.unref()` is actually invoked,
//      asserted via a spy (not via observed event-loop behaviour,
//      which would silently pass if the call were dropped).

import { describe, test, expect, vi } from "vitest";
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

/**
 * Spawn a `node -e` child and wait until it prints a readiness
 * marker on stdout. Used by the SIGTERM-ignoring test so the kernel
 * cannot win the race: a fixed `setTimeout(100)` was flaky on busy
 * CI runners where the JS SIGTERM handler hadn't attached yet by
 * the time we sent the signal, and the child would exit to SIGTERM
 * instead of needing SIGKILL escalation.
 */
async function spawnReady(script: string, marker: string): Promise<ChildProcess> {
  const proc = spawn(process.execPath, ["-e", script]);
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer): void => {
      if (chunk.toString().includes(marker)) {
        proc.stdout?.off("data", onData);
        resolve();
      }
    };
    proc.stdout?.on("data", onData);
    proc.once("error", reject);
    proc.once("exit", () => reject(new Error("child exited before signalling ready")));
  });
  return proc;
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
    // The child installs a SIGTERM handler that swallows the signal,
    // then prints "ready\n" so the test knows the handler is wired
    // up before we call `terminateAgdaProcess`. Replacing the old
    // fixed `setTimeout(100)` with a stdout marker eliminates a
    // race where a slow CI runner could let SIGTERM arrive before
    // the handler was registered — the child would exit on SIGTERM
    // and the test would intermittently see the wrong signal.
    const script = [
      "process.on('SIGTERM', () => {});",
      "process.stdout.write('ready\\n');",
      "setInterval(() => {}, 1_000_000);",
    ].join("");
    const proc = await spawnReady(script, "ready");

    terminateAgdaProcess(proc, { graceMs: 200 });

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

  test("escalation timer is unref()'d so it doesn't keep node alive", () => {
    // We don't observe event-loop behaviour here — a regression
    // where someone deletes `.unref()` would silently pass that
    // observational test because the awaited `close` event already
    // keeps the loop alive. Instead, wrap setTimeout so we can
    // assert directly that `.unref()` was called on the Timer
    // returned for the escalation schedule.
    const unrefCalls: number[] = [];
    const realSetTimeout = global.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(((handler: TimerHandler, timeout?: number, ...rest: unknown[]) => {
        const timer = realSetTimeout(handler, timeout, ...rest) as NodeJS.Timeout;
        const originalUnref = timer.unref.bind(timer);
        timer.unref = () => {
          unrefCalls.push(timeout ?? 0);
          return originalUnref();
        };
        return timer;
      }) as typeof setTimeout);

    try {
      // Use a fake proc so we don't depend on a real subprocess
      // closing on its own — that would clear the escalation timer
      // before we can observe it. The fake never fires `close`, so
      // `terminateAgdaProcess` schedules the SIGKILL timer and
      // (the contract under test) immediately calls .unref() on it.
      const fakeProc: Pick<ChildProcess, "exitCode" | "signalCode" | "killed" | "kill"> & {
        once(event: string, listener: () => void): unknown;
      } = {
        exitCode: null,
        signalCode: null,
        killed: false,
        kill: (() => {
          (fakeProc as { killed: boolean }).killed = true;
          return true;
        }) as ChildProcess["kill"],
        once(_event: string, _listener: () => void) {
          return fakeProc as unknown as ChildProcess;
        },
      };

      const graceMs = 60_000;
      terminateAgdaProcess(fakeProc as unknown as ChildProcess, { graceMs });

      // At least one of the scheduled timers must be the SIGKILL
      // escalation with our exact graceMs — assert .unref() ran on
      // that one.
      expect(unrefCalls).toContain(graceMs);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
