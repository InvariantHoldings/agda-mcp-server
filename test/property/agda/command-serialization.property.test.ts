import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import type { ChildProcess } from "node:child_process";

import { AgdaSession } from "../../../src/agda-process.js";

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

        session.ensureProcess = () => ({ exitCode: null } as unknown as ChildProcess);

        const promises = Array.from({ length: concurrency }, (_, i) =>
          session.sendCommand(`IOTCM cmd${i}`),
        );

        const results = await Promise.all(promises);
        expect(results.length).toBe(concurrency);
        // The key invariant: at most 1 command active at any time
        expect(maxConcurrent).toBe(1);

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

        // Bypass version detection so only user commands appear in executionOrder
        session["versionDetectionAttempts"] = (AgdaSession as any)["VERSION_DETECTION_MAX_ATTEMPTS"];

        const executionOrder: string[] = [];

        session["transport"].sendCommand = async function (_proc, command, _timeoutMs) {
          executionOrder.push(command);
          await new Promise((resolve) => setTimeout(resolve, 1));
          return [{ kind: "Status" }];
        };

        session.ensureProcess = () => ({ exitCode: null } as unknown as ChildProcess);

        const commands = Array.from({ length: concurrency }, (_, i) => `IOTCM cmd${i}`);
        await Promise.all(commands.map((cmd) => session.sendCommand(cmd)));

        // Commands must execute in the order they were submitted
        expect(executionOrder).toEqual(commands);

        session.destroy();
      },
    ),
    { numRuns: 20 },
  );
});
