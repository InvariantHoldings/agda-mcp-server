// Tests for the version detection ordering and retry behaviour introduced in
// the inline-detection refactor. The key invariant: getAgdaVersion() is
// populated for the *same* sendCommand call that triggers detection — not
// only for subsequent calls.

import { test, expect } from "vitest";
import type { ChildProcess } from "node:child_process";

import { AgdaSession } from "../../../src/agda-process.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Minimal fake ChildProcess accepted by ensureProcess mocks. */
const fakeProc = { exitCode: null } as unknown as ChildProcess;

function makeVersionMock(versionString: string) {
  return async function (_proc: unknown, command: string, _timeout: unknown) {
    if (command.includes("Cmd_show_version")) {
      // Real Agda protocol: kind=DisplayInfo at response level, kind=Version at info level
      return [{ kind: "DisplayInfo", info: { kind: "Version", version: versionString } }];
    }
    return [{ kind: "Status" }];
  };
}

// ── Ordering: version available within the triggering command ──────────────

test("getAgdaVersion() is populated after the first sendCommand resolves", async () => {
  const session = new AgdaSession(process.cwd());
  session["transport"].sendCommand = makeVersionMock("Agda version 2.9.0") as any;
  session.ensureProcess = () => fakeProc;

  // Before any command, version is null
  expect(session.getAgdaVersion()).toBeNull();

  await session.sendCommand("IOTCM cmd1");

  // After the first command, version is populated
  expect(session.getAgdaVersion()).not.toBeNull();
  expect(session.getAgdaVersion()!.parts).toEqual([2, 9, 0]);

  session.destroy();
});

test("getAgdaVersion() is populated for subsequent commands too", async () => {
  const session = new AgdaSession(process.cwd());
  session["transport"].sendCommand = makeVersionMock("Agda version 2.7.0") as any;
  session.ensureProcess = () => fakeProc;

  await session.sendCommand("IOTCM cmd1");
  await session.sendCommand("IOTCM cmd2");

  expect(session.getAgdaVersion()!.parts).toEqual([2, 7, 0]);

  session.destroy();
});

// ── Filtering: non-Version DisplayInfo responses are not mis-parsed ─────────

test("detection ignores timing and other non-Version DisplayInfo responses", async () => {
  const session = new AgdaSession(process.cwd());
  let callCount = 0;
  session["transport"].sendCommand = async function (_proc: unknown, command: string) {
    if (command.includes("Cmd_show_version")) {
      callCount++;
      // Return a Time response followed by the real Version response.
      // The Time message contains digit sequences that could be mistakenly
      // parsed as a version if the kind filtering is absent.
      return [
        { kind: "DisplayInfo", info: { kind: "Time", cpuTime: 0.042, message: "Time: 0.042s" } },
        { kind: "DisplayInfo", info: { kind: "Version", version: "Agda version 2.9.0" } },
      ];
    }
    return [{ kind: "Status" }];
  } as any;
  session.ensureProcess = () => fakeProc;

  await session.sendCommand("IOTCM cmd1");

  // Must parse as 2.9.0, not as something derived from timing output
  expect(session.getAgdaVersion()).not.toBeNull();
  expect(session.getAgdaVersion()!.parts).toEqual([2, 9, 0]);

  session.destroy();
});

test("detection stays null when Cmd_show_version returns only non-Version DisplayInfo", async () => {
  const session = new AgdaSession(process.cwd());
  session["transport"].sendCommand = async function (_proc: unknown, command: string) {
    if (command.includes("Cmd_show_version")) {
      // No Version info — only a Time response
      return [
        { kind: "DisplayInfo", info: { kind: "Time", cpuTime: 2, message: "2.9" } },
      ];
    }
    return [{ kind: "Status" }];
  } as any;
  session.ensureProcess = () => fakeProc;

  await session.sendCommand("IOTCM cmd1");

  // The Time message contains "2.9" — a string that would parse as a valid
  // Agda version if kind filtering were absent. Asserting null proves the
  // filter is working and "2.9" was not extracted from the Time response.
  expect(session.getAgdaVersion()).toBeNull();

  session.destroy();
});

// ── Retry: transient detection failures are retried on the next command ────

test("detection retries after a transient transport failure", async () => {
  const session = new AgdaSession(process.cwd());
  let attempt = 0;
  session["transport"].sendCommand = async function (_proc: unknown, command: string) {
    if (command.includes("Cmd_show_version")) {
      attempt++;
      if (attempt === 1) throw new Error("transient error");
      return [{ kind: "DisplayInfo", info: { kind: "Version", version: "Agda version 2.6.4" } }];
    }
    return [{ kind: "Status" }];
  } as any;
  session.ensureProcess = () => fakeProc;

  // First command: version detection fails (transient)
  await session.sendCommand("IOTCM cmd1");
  expect(session.getAgdaVersion()).toBeNull();

  // Second command: detection succeeds on retry
  await session.sendCommand("IOTCM cmd2");
  expect(session.getAgdaVersion()).not.toBeNull();
  expect(session.getAgdaVersion()!.parts).toEqual([2, 6, 4]);

  session.destroy();
});

test("detection stops retrying after VERSION_DETECTION_MAX_ATTEMPTS failures", async () => {
  const session = new AgdaSession(process.cwd());
  const max = AgdaSession.VERSION_DETECTION_MAX_ATTEMPTS;

  session["transport"].sendCommand = async function (_proc: unknown, command: string) {
    if (command.includes("Cmd_show_version")) throw new Error("permanent failure");
    return [{ kind: "Status" }];
  } as any;
  session.ensureProcess = () => fakeProc;

  // Exhaust all attempts
  for (let i = 0; i < max; i++) {
    await session.sendCommand(`IOTCM cmd${i}`);
  }
  expect(session.getAgdaVersion()).toBeNull();

  // After max attempts, the counter is at the cap — no more detection
  expect(session["versionDetectionAttempts"]).toBe(max);

  // An extra command should not try again (counter stays at cap)
  await session.sendCommand("IOTCM extra");
  expect(session["versionDetectionAttempts"]).toBe(max);

  session.destroy();
});

// ── Reset: destroy() and process restart reset detection state ─────────────

test("destroy() resets versionDetectionAttempts and detectedVersion", () => {
  const session = new AgdaSession(process.cwd());

  // Simulate a session that already ran detection
  session["detectedVersion"] = { parts: [2, 9, 0], prerelease: false };
  session["versionDetectionAttempts"] = 2;

  session.destroy();

  expect(session.getAgdaVersion()).toBeNull();
  expect(session["versionDetectionAttempts"]).toBe(0);
});

test("process close event resets detection state for the next process", async () => {
  const session = new AgdaSession(process.cwd());
  session["transport"].sendCommand = makeVersionMock("Agda version 2.9.0") as any;
  session.ensureProcess = () => fakeProc;

  await session.sendCommand("IOTCM cmd1");
  expect(session.getAgdaVersion()).not.toBeNull();

  // Directly invoke the same state reset that the process 'close' event handler
  // performs. (The handler is registered on this.proc inside the real
  // ensureProcess(); since ensureProcess is mocked here to return a plain
  // object the close event cannot be emitted. The state it resets is what matters.)
  session["detectedVersion"] = null;
  session["versionDetectionAttempts"] = 0;

  // Next command detects again, proving the reset was sufficient for re-detection
  await session.sendCommand("IOTCM cmd2");
  expect(session.getAgdaVersion()).not.toBeNull();
  expect(session.getAgdaVersion()!.parts).toEqual([2, 9, 0]);

  session.destroy();
});

// ── Piggyback: no double round-trip when user command IS Cmd_show_version ──

test("no pre-flight when user command is Cmd_show_version — version piggybacked instead", async () => {
  const session = new AgdaSession(process.cwd());
  let cmdCount = 0;
  session["transport"].sendCommand = async function (_proc: unknown, command: string) {
    cmdCount++;
    if (command.includes("Cmd_show_version")) {
      return [{ kind: "DisplayInfo", info: { kind: "Version", version: "Agda version 2.9.0" } }];
    }
    return [{ kind: "Status" }];
  } as any;
  session.ensureProcess = () => fakeProc;

  // User's first command IS Cmd_show_version
  const vCmd = session["iotcm"]("Cmd_show_version");
  await session.sendCommand(vCmd);

  // Exactly ONE transport call should have been made (no extra pre-flight)
  expect(cmdCount).toBe(1);

  // Version should be populated from the piggybacked response
  expect(session.getAgdaVersion()).not.toBeNull();
  expect(session.getAgdaVersion()!.parts).toEqual([2, 9, 0]);

  session.destroy();
});

// ── Preflight respawn guard (0.6.7 Copilot review fix) ────────────────────

test("sendCommand respawns the proc when the preflight version probe killed it", async () => {
  // Regression for Copilot review comments on PR #56: `sendCommand`
  // is also used internally by `preflightVersionDetection`. When the
  // preflight times out, `terminateAgdaProcess` kills the shared
  // child but `preflightVersionDetection` resolves normally and
  // `AgdaSession.sendCommand` used to pass the (now dying) `proc`
  // straight to the user-command call. The fix calls `ensureProcess()`
  // a SECOND time between the preflight and the user command so the
  // killed-but-not-yet-closed proc is detected via `.killed` and
  // respawned.
  //
  // The first version of this test just counted `ensureProcess`
  // calls and passed for any implementation that called it twice,
  // even one that did nothing meaningful with the result. This
  // version actually exercises the killed-proc path:
  //   - First `ensureProcess` returns `dyingProc`.
  //   - Preflight transport call sets `dyingProc.killed = true`
  //     (simulating `terminateAgdaProcess` from a timeout).
  //   - Second `ensureProcess` must return a DIFFERENT proc
  //     (`freshProc`), and the user command must be sent to that
  //     fresh proc, not the dying one.
  const session = new AgdaSession(process.cwd());
  const dyingProc = { exitCode: null, signalCode: null, killed: false } as unknown as ChildProcess & {
    killed: boolean;
  };
  const freshProc = { exitCode: null, signalCode: null, killed: false } as unknown as ChildProcess;

  let ensureCalls = 0;
  session.ensureProcess = () => {
    ensureCalls += 1;
    // First call (start of sendCommand) → dyingProc. Subsequent
    // calls (re-acquire after preflight) → freshProc.
    return ensureCalls === 1 ? dyingProc : freshProc;
  };

  const sendCommandCalls: Array<{ proc: ChildProcess; command: string }> = [];
  session["transport"].sendCommand = (async (proc: ChildProcess, command: string) => {
    sendCommandCalls.push({ proc, command });
    if (command.includes("Cmd_show_version")) {
      // Simulate a preflight timeout: terminate the proc (set
      // .killed) and resolve with empty responses, mirroring the
      // observable behaviour of `AgdaTransport.sendCommand`'s
      // timeout branch after the v0.6.7 leak fix.
      (dyingProc as { killed: boolean }).killed = true;
      return [];
    }
    return [{ kind: "Status" }];
  }) as any;

  await session.sendCommand("IOTCM cmd1");

  // ensureProcess called twice: initial + re-acquire after preflight.
  expect(ensureCalls).toBe(2);

  // The user command must be sent to `freshProc`, NOT `dyingProc`.
  const userCall = sendCommandCalls.find((c) => !c.command.includes("Cmd_show_version"));
  expect(userCall).toBeDefined();
  expect(userCall!.proc).toBe(freshProc);
  // And the preflight call WAS the one sent to the dying proc.
  const preflightCall = sendCommandCalls.find((c) => c.command.includes("Cmd_show_version"));
  expect(preflightCall!.proc).toBe(dyingProc);

  session.destroy();
});

test("subsequent non-version commands don't re-run detection after successful piggyback", async () => {
  const session = new AgdaSession(process.cwd());
  let cmdCount = 0;
  session["transport"].sendCommand = async function (_proc: unknown, command: string) {
    cmdCount++;
    if (command.includes("Cmd_show_version")) {
      return [{ kind: "DisplayInfo", info: { kind: "Version", version: "Agda version 2.9.0" } }];
    }
    return [{ kind: "Status" }];
  } as any;
  session.ensureProcess = () => fakeProc;

  // First command: piggyback detects version
  const vCmd = session["iotcm"]("Cmd_show_version");
  await session.sendCommand(vCmd);
  expect(cmdCount).toBe(1);

  // Second command: detection is already done; no extra Cmd_show_version
  await session.sendCommand("IOTCM cmd2");
  // Only the user command itself — no pre-flight
  expect(cmdCount).toBe(2);

  session.destroy();
});

// ── Stale-currentFile guard after a per-command timeout (PR #56) ──────────

test("a timeout that kills the proc resets currentFile so the next caller sees 'No file loaded'", async () => {
  // Regression for Copilot review comment on PR #56: when a
  // per-command timeout in `AgdaTransport.sendCommand` kills the
  // subprocess, the session previously kept its `currentFile` and
  // related goal state. A follow-up command (e.g. `goalTypeContext`,
  // which calls `requireFile()` then builds the IOTCM string from
  // `currentFile` BEFORE handing it to `sendCommand`) would pass the
  // file-loaded check, build a stale envelope against the dead file,
  // and `sendCommand` would respawn a fresh Agda inside
  // `ensureProcess()` and forward the stale envelope into it.
  // The fix: reset every file-bound field when we detect that the
  // proc died during the command.
  const session = new AgdaSession(process.cwd());

  // Seed loaded-file state the way a successful `load()` would.
  session.currentFile = "/tmp/Stale.agda";
  session.goalIds = [0, 1];
  session.lastLoadedMtime = 12345;
  session.lastClassification = "ok-with-holes";
  session.lastLoadedAt = Date.now();
  session.lastInvisibleGoalCount = 0;

  const dyingProc = { exitCode: null, signalCode: null, killed: false } as unknown as ChildProcess;
  session.ensureProcess = () => dyingProc;
  // Mimic the post-fix `AgdaTransport.sendCommand` timeout branch:
  // flip `proc.killed` and resolve with the partial responses bag.
  session["transport"].sendCommand = (async () => {
    (dyingProc as unknown as { killed: boolean }).killed = true;
    return [];
  }) as any;

  await session.sendCommand("IOTCM cmd_that_times_out");

  expect(session.getLoadedFile()).toBeNull();
  expect(session.getGoalIds()).toEqual([]);
  expect(session.getLastClassification()).toBeNull();
  expect(session.getLastLoadedAt()).toBeNull();

  session.destroy();
});
