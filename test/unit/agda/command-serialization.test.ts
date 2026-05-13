import { test, expect } from "vitest";
import type { ChildProcess } from "node:child_process";

import { AgdaSession } from "../../../src/agda-process.js";

function withEnv(name: string, value: string, fn: () => Promise<void>) {
  const previous = process.env[name];
  process.env[name] = value;

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous;
      }
    });
}

// ── Bug 3: Concurrent sendCommand calls must be serialized ──────────

test("AgdaSession serializes concurrent sendCommand calls (Bug 3)", async () => {
  await withEnv("AGDA_MCP_IDLE_COMPLETION_MS", "5", async () => {
    const session = new AgdaSession(process.cwd());

    // Bypass version detection so the mock only sees user commands
    session["versionDetectionAttempts"] = AgdaSession.VERSION_DETECTION_MAX_ATTEMPTS;

    // Track the order commands arrive at the transport
    const commandOrder: Array<{ idx: number; event: string; command: string }> = [];
    let commandIndex = 0;

    session["transport"].sendCommand = async function (_proc, command, _timeoutMs) {
      const idx = commandIndex++;
      commandOrder.push({ idx, event: "start", command: command.slice(0, 40) });
      // Simulate Agda taking time to process
      await new Promise((resolve) => setTimeout(resolve, 10));
      commandOrder.push({ idx, event: "end", command: command.slice(0, 40) });
      return [{ kind: "Status" }];
    };

    session.ensureProcess = () => ({ exitCode: null } as unknown as ChildProcess);

    try {
      // Fire 3 concurrent commands
      const results = await Promise.all([
        session.sendCommand("IOTCM cmd1"),
        session.sendCommand("IOTCM cmd2"),
        session.sendCommand("IOTCM cmd3"),
      ]);

      // All three should succeed
      expect(results.length).toBe(3);
      for (const r of results) {
        expect(r).toEqual([{ kind: "Status" }]);
      }

      // Commands must be serialized: each "start" must come after previous "end"
      expect(commandOrder.length).toBe(6);
      for (let i = 0; i < commandOrder.length; i += 2) {
        expect(commandOrder[i].event).toBe("start");
        expect(commandOrder[i + 1].event).toBe("end");
        expect(commandOrder[i].idx).toBe(commandOrder[i + 1].idx);
      }

      // Verify strict serialization order: start0, end0, start1, end1, start2, end2
      expect(
        commandOrder.map((e) => e.event),
      ).toEqual(
        ["start", "end", "start", "end", "start", "end"],
      );
    } finally {
      session.destroy();
    }
  });
});

test("AgdaSession command queue does not block after a rejected command (Bug 3)", async () => {
  const session = new AgdaSession(process.cwd());

  // Bypass version detection so the mock only sees user commands
  session["versionDetectionAttempts"] = AgdaSession.VERSION_DETECTION_MAX_ATTEMPTS;

  let callCount = 0;
  session["transport"].sendCommand = async function (_proc, command, _timeoutMs) {
    callCount++;
    if (command.includes("fail")) {
      throw new Error("simulated failure");
    }
    return [{ kind: "Status" }];
  };

  session.ensureProcess = () => ({ exitCode: null } as unknown as ChildProcess);

  // First command fails
  await expect(
    session.sendCommand("IOTCM fail"),
  ).rejects.toThrow(/simulated failure/);

  // Second command should still execute, not deadlock
  const result = await session.sendCommand("IOTCM succeed");
  expect(result).toEqual([{ kind: "Status" }]);
  expect(callCount).toBe(2);

  session.destroy();
});

test("AgdaSession destroy rejects queued and subsequent sendCommand calls", async () => {
  // Updated for the 0.6.7 leak-cleanup pass: destroy() is now
  // final. Tasks that were chained onto `commandQueue` before
  // destroy() ran observe `this.destroyed === true` when their
  // turn comes and reject — without this guard a queued command
  // could call `ensureProcess()` and spawn a fresh Agda just as
  // shutdown is awaiting the previous proc's exit (see Copilot
  // review comment on PR #56: `session-process-lifecycle.ts:198`).
  // Embedders that need a fresh session after teardown must
  // construct a new `AgdaSession`.
  const session = new AgdaSession(process.cwd());

  let callCount = 0;
  session["transport"].sendCommand = async function (_proc, command, _timeoutMs) {
    if (command.includes("block")) {
      return new Promise(() => {});
    }
    if (command.includes("Cmd_show_version")) {
      return [];
    }
    callCount++;
    return [{ kind: "Status" }];
  };

  session.ensureProcess = () => ({ exitCode: null } as unknown as ChildProcess);

  // Enqueue a permanently blocked command; capture its Promise so
  // we can assert it rejects after destroy.
  const blocked = session.sendCommand("IOTCM block");

  // destroy() flips the `destroyed` flag and resets commandQueue.
  // The blocked task is still chained off the OLD queue, but its
  // `.then` body checks `this.destroyed` and throws.
  await session.destroy();

  await expect(blocked).rejects.toThrow(/destroyed/);

  // A NEW sendCommand call after destroy() must also reject — the
  // session is gone for good. Without this contract, a queued task
  // could sneak through after destroy and spawn a fresh Agda
  // mid-shutdown.
  await expect(session.sendCommand("IOTCM after-destroy")).rejects.toThrow(/destroyed/);

  // The non-blocked branch of the transport mock must never have run.
  expect(callCount).toBe(0);
});
