import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { AgdaSession } from "../../../dist/agda-process.js";

// ── Bug 3: Property — concurrent commands are always serialized ─────

test("concurrent sendCommand calls never overlap regardless of count (Bug 3)", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 2, max: 8 }),
      async (concurrency) => {
        const session = new AgdaSession(process.cwd());
        let activeCount = 0;
        let maxConcurrent = 0;

        session["transport"].sendCommand = async function (_proc, _command, _timeoutMs) {
          activeCount++;
          maxConcurrent = Math.max(maxConcurrent, activeCount);
          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, 1));
          activeCount--;
          return [{ kind: "Status" }];
        };

        session.ensureProcess = () => ({ exitCode: null });

        const promises = Array.from({ length: concurrency }, (_, i) =>
          session.sendCommand(`IOTCM cmd${i}`),
        );

        const results = await Promise.all(promises);
        assert.equal(results.length, concurrency);
        // The key invariant: at most 1 command active at any time
        assert.equal(maxConcurrent, 1, `expected max 1 concurrent, got ${maxConcurrent}`);

        session.destroy();
      },
    ),
    { numRuns: 20 },
  );
});

test("command queue preserves FIFO order under concurrent dispatch (Bug 3)", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 2, max: 6 }),
      async (concurrency) => {
        const session = new AgdaSession(process.cwd());
        const executionOrder = [];

        session["transport"].sendCommand = async function (_proc, command, _timeoutMs) {
          executionOrder.push(command);
          await new Promise((resolve) => setTimeout(resolve, 1));
          return [{ kind: "Status" }];
        };

        session.ensureProcess = () => ({ exitCode: null });

        const commands = Array.from({ length: concurrency }, (_, i) => `IOTCM cmd${i}`);
        await Promise.all(commands.map((cmd) => session.sendCommand(cmd)));

        // Commands must execute in the order they were submitted
        assert.deepEqual(executionOrder, commands);

        session.destroy();
      },
    ),
    { numRuns: 20 },
  );
});
