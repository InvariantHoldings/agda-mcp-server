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
      await session.destroy();
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

  await session.destroy();
});

test("AgdaSession control commands cancel a user command stuck inside preflight version detection (interruption propagates through preflight's best-effort catch)", async () => {
  // Regression for Copilot review on PR #56 (round 7 /
  // `session.ts:381`): `rejectInFlightCommand` interrupts whatever
  // `transport.sendCommand` is currently awaiting. If the active
  // session command is still inside `preflightVersionDetection` —
  // the first sendCommand it dispatches is the version probe — that
  // helper used to swallow ANY transport error as a best-effort
  // probe failure. The interruption was lost; the user command
  // proceeded to its real sendCommand call; the queued abort/exit
  // ended up waiting BEHIND the very command it was supposed to
  // cancel. The fix: `rejectInFlightCommand({ controlCommand: true })`
  // emits a `ControlCommandInterruption`, which preflight re-throws.
  const session = new AgdaSession(process.cwd());

  let probeStarted = false;
  let resolveProbeStarted!: () => void;
  const probeStartedBarrier = new Promise<void>((resolve) => { resolveProbeStarted = resolve; });
  let userCommandRan = false;

  session["transport"].sendCommand = async function (_proc, command) {
    if (command.includes("Cmd_show_version")) {
      probeStarted = true;
      resolveProbeStarted();
      // Block here on the shared emitter until the control command
      // interrupts us. Without the fix, the catch in preflight
      // swallowed this error and let the user command run.
      return await new Promise<never>((_resolve, reject) => {
        session["transport"].emitter.once("error", (err) => reject(err));
      });
    }
    // If we ever reach here, the regression has re-emerged: the
    // user command ran despite the in-flight abort.
    userCommandRan = true;
    return [{ kind: "Status" }];
  };
  session["transport"].sendFireAndForgetCommand = (async () => []) as unknown as typeof session["transport"]["sendFireAndForgetCommand"];

  session.ensureProcess = () => ({ exitCode: null } as unknown as ChildProcess);

  try {
    const userCmd = session.sendCommand("IOTCM user_cmd");
    await probeStartedBarrier;
    expect(probeStarted).toBe(true);

    // Fire abort while the user command is stuck inside preflight.
    const aborted = session.abort();

    await expect(userCmd).rejects.toThrow(/Interrupted by Agda control command/);
    await aborted;

    expect(userCommandRan).toBe(false);
  } finally {
    await session.destroy();
  }
});

test("AgdaSession control commands (abort/exit) chain through commandQueue so their flush window cannot clobber a subsequent sendCommand's transport state", async () => {
  // Regression for Copilot review on PR #56 (round 6 /
  // `session.ts:364`): the previous `sendControlCommand` bypassed
  // `commandQueue` entirely and held shared transport state
  // (`collecting`, idle timer) for `flushMs`. When the in-flight
  // command rejected, the next queued `sendCommand` could start
  // immediately — and the still-pending flush timer would later flip
  // `collecting=false` mid-flight. The fix interrupts the in-flight
  // command synchronously, then chains the fire-and-forget through
  // `commandQueue` so subsequent commands wait for the flush to
  // resolve before they touch transport state.
  const session = new AgdaSession(process.cwd());
  session["versionDetectionAttempts"] = AgdaSession.VERSION_DETECTION_MAX_ATTEMPTS;

  const events: string[] = [];
  let releaseAbortFlush!: () => void;
  const abortFlushHeld = new Promise<void>((resolve) => { releaseAbortFlush = resolve; });
  let firstReachedTransport!: () => void;
  const firstAwaitingTransport = new Promise<void>((resolve) => { firstReachedTransport = resolve; });

  // Fire-and-forget mock holds the flush window open until the test
  // says "release". This lets us assert on transport-state ordering
  // without relying on wall-clock timing.
  session["transport"].sendFireAndForgetCommand = (async () => {
    events.push("abort:start");
    await abortFlushHeld;
    events.push("abort:end");
    return [];
  }) as unknown as typeof session["transport"]["sendFireAndForgetCommand"];

  session["transport"].sendCommand = async function (_proc, command) {
    if (command.includes("first")) {
      events.push("first:awaiting");
      firstReachedTransport();
      return await new Promise<never>((_resolve, reject) => {
        session["transport"].emitter.once("error", (err) => reject(err));
      });
    }
    events.push(`${command}:start`);
    return [{ kind: "Status" }];
  };

  session.ensureProcess = () => ({ exitCode: null } as unknown as ChildProcess);

  try {
    const first = session.sendCommand("IOTCM first").catch(() => { /* expected */ });
    // Wait for `first` to actually be parked inside transport.sendCommand
    // before firing `abort` — otherwise `rejectInFlightCommand`'s emit
    // would land before any listener registered.
    await firstAwaitingTransport;

    const aborted = session.abort();
    const next = session.sendCommand("IOTCM next");

    // Yield enough microtasks for `abort` to acquire its queue slot
    // and call `sendFireAndForgetCommand` (which pushes "abort:start").
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Decisive invariant: while abort's flush window is still open,
    // `next` MUST NOT have started — it is chained AFTER abort in
    // commandQueue. With the buggy queue-bypass, `next` would run
    // immediately after `first` rejected.
    expect(events).toContain("abort:start");
    expect(events.some((e) => e === "IOTCM next:start")).toBe(false);

    // Release the flush and let everything settle.
    releaseAbortFlush();
    await Promise.all([first, aborted, next]);

    // Final ordering check.
    expect(events.indexOf("abort:end")).toBeLessThan(events.indexOf("IOTCM next:start"));
  } finally {
    await session.destroy();
  }
});

test("AgdaSession preflight failure that kills the proc resets file-bound state before the assertion throws", async () => {
  // Regression for Copilot review on PR #56 (round 6 /
  // `session.ts:206`): when the version preflight timed out and
  // killed the subprocess, `preflightVersionDetection` swallowed the
  // transport error; `assertProcSurvivedPreflight` then threw — but
  // OUTSIDE the try/finally that calls `resetFileBoundStateIfProcDied`,
  // so `currentFile`/`goalIds`/load metadata stayed pointing at the
  // dead Agda until the eventual `close` event landed. The fix wraps
  // the assertion in the try/finally so the reset always runs.
  const session = new AgdaSession(process.cwd());

  session.currentFile = "/tmp/StaleAfterPreflight.agda";
  session.goalIds = [0, 1];
  session.lastLoadedMtime = 12345;
  session.lastClassification = "ok-with-holes";
  session.lastLoadedAt = Date.now();
  session.lastInvisibleGoalCount = 0;

  const dyingProc = { exitCode: null, signalCode: null, killed: false } as unknown as ChildProcess;
  session.ensureProcess = () => dyingProc;
  // Preflight throws after marking proc killed — mimics the timeout
  // path inside `AgdaTransport.sendCommand`.
  session["transport"].sendCommand = (async (_proc: ChildProcess, command: string) => {
    if (command.includes("Cmd_show_version")) {
      (dyingProc as unknown as { killed: boolean }).killed = true;
      throw new Error("simulated preflight timeout");
    }
    // The user's command must NEVER be sent against the dead proc —
    // the preflight survival assertion is supposed to throw first.
    throw new Error("user command must not run against a dead proc");
  }) as any;

  await expect(session.sendCommand("IOTCM user_cmd")).rejects.toThrow(
    /Agda subprocess was replaced during version preflight/,
  );

  // The fix's contract: state was reset even though the throw came
  // from `assertProcSurvivedPreflight`, NOT from inside the wrapped
  // `transport.sendCommand`.
  expect(session.getLoadedFile()).toBeNull();
  expect(session.getGoalIds()).toEqual([]);
  expect(session.getLastClassification()).toBeNull();
  expect(session.getLastLoadedAt()).toBeNull();

  await session.destroy();
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
