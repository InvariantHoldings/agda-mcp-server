import test from "node:test";
import assert from "node:assert/strict";

import { AgdaSession } from "../../../dist/agda-process.js";

function withEnv(name, value, fn) {
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

    // Track the order commands arrive at the transport
    const commandOrder = [];
    let commandIndex = 0;

    session["transport"].sendCommand = async function (_proc, command, _timeoutMs) {
      const idx = commandIndex++;
      commandOrder.push({ idx, event: "start", command: command.slice(0, 40) });
      // Simulate Agda taking time to process
      await new Promise((resolve) => setTimeout(resolve, 10));
      commandOrder.push({ idx, event: "end", command: command.slice(0, 40) });
      return [{ kind: "Status" }];
    };

    session.ensureProcess = () => ({ exitCode: null });

    try {
      // Fire 3 concurrent commands
      const results = await Promise.all([
        session.sendCommand("IOTCM cmd1"),
        session.sendCommand("IOTCM cmd2"),
        session.sendCommand("IOTCM cmd3"),
      ]);

      // All three should succeed
      assert.equal(results.length, 3);
      for (const r of results) {
        assert.deepEqual(r, [{ kind: "Status" }]);
      }

      // Commands must be serialized: each "start" must come after previous "end"
      assert.equal(commandOrder.length, 6);
      for (let i = 0; i < commandOrder.length; i += 2) {
        assert.equal(commandOrder[i].event, "start");
        assert.equal(commandOrder[i + 1].event, "end");
        assert.equal(commandOrder[i].idx, commandOrder[i + 1].idx);
      }

      // Verify strict serialization order: start0, end0, start1, end1, start2, end2
      assert.deepEqual(
        commandOrder.map((e) => e.event),
        ["start", "end", "start", "end", "start", "end"],
      );
    } finally {
      session.destroy();
    }
  });
});

test("AgdaSession command queue does not block after a rejected command (Bug 3)", async () => {
  const session = new AgdaSession(process.cwd());

  let callCount = 0;
  session["transport"].sendCommand = async function (_proc, command, _timeoutMs) {
    callCount++;
    if (command.includes("fail")) {
      throw new Error("simulated failure");
    }
    return [{ kind: "Status" }];
  };

  session.ensureProcess = () => ({ exitCode: null });

  // First command fails
  await assert.rejects(
    session.sendCommand("IOTCM fail"),
    /simulated failure/,
  );

  // Second command should still execute, not deadlock
  const result = await session.sendCommand("IOTCM succeed");
  assert.deepEqual(result, [{ kind: "Status" }]);
  assert.equal(callCount, 2);

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
    callCount++;
    return [{ kind: "Status" }];
  };

  session.ensureProcess = () => ({ exitCode: null });

  // Enqueue a permanently blocked command; do not await it
  void session.sendCommand("IOTCM block");

  // destroy() should reset the internal command queue
  session.destroy();

  // After destroy, a new command should execute without being blocked
  const result = await session.sendCommand("IOTCM after-destroy");
  assert.deepEqual(result, [{ kind: "Status" }]);
  assert.equal(callCount, 1);

  session.destroy();
});
