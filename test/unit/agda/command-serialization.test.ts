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
    session["versionDetectionAttempts"] = (AgdaSession as any)["VERSION_DETECTION_MAX_ATTEMPTS"];

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
  session["versionDetectionAttempts"] = (AgdaSession as any)["VERSION_DETECTION_MAX_ATTEMPTS"];

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

test("AgdaSession destroy resets the command queue", async () => {
  const session = new AgdaSession(process.cwd());

  let callCount = 0;
  session["transport"].sendCommand = async function (_proc, command, _timeoutMs) {
    if (command.includes("block")) {
      // Simulate a command that never resolves — would block the queue
      return new Promise(() => {});
    }
    if (command.includes("Cmd_show_version")) {
      // Version detection runs inline; don't count it toward user command assertions
      return [];
    }
    callCount++;
    return [{ kind: "Status" }];
  };

  session.ensureProcess = () => ({ exitCode: null } as unknown as ChildProcess);

  // Enqueue a permanently blocked command; do not await it
  void session.sendCommand("IOTCM block");

  // destroy() should reset the internal command queue
  session.destroy();

  // After destroy, a new command should execute without being blocked
  const result = await session.sendCommand("IOTCM after-destroy");
  expect(result).toEqual([{ kind: "Status" }]);
  expect(callCount).toBe(1);

  session.destroy();
});
