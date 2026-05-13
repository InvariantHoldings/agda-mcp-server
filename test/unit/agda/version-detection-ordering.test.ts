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

  await session.destroy();
});

test("getAgdaVersion() is populated for subsequent commands too", async () => {
  const session = new AgdaSession(process.cwd());
  session["transport"].sendCommand = makeVersionMock("Agda version 2.7.0") as any;
  session.ensureProcess = () => fakeProc;

  await session.sendCommand("IOTCM cmd1");
  await session.sendCommand("IOTCM cmd2");

  expect(session.getAgdaVersion()!.parts).toEqual([2, 7, 0]);

  await session.destroy();
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

  await session.destroy();
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

  await session.destroy();
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

  await session.destroy();
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

  await session.destroy();
});

// ── Reset: destroy() and process restart reset detection state ─────────────

test("destroy() resets versionDetectionAttempts and detectedVersion", async () => {
  const session = new AgdaSession(process.cwd());

  // Simulate a session that already ran detection
  session["detectedVersion"] = { parts: [2, 9, 0], prerelease: false };
  session["versionDetectionAttempts"] = 2;

  await session.destroy();

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

  await session.destroy();
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

  await session.destroy();
});

// ── Preflight respawn guard (PR #56 Copilot review) ───────────────────────

test("sendCommand rejects the user command when the preflight version probe killed the proc", async () => {
  // The user's IOTCM envelope was built BEFORE preflight ran (e.g.
  // `goalTypeContext` builds it inline with `ctx.sendCommand(...)`),
  // so its file path and goal IDs reference the previous process.
  // Sending it to a respawned Agda would either trip "No file loaded"
  // or target stale interaction IDs in the new process. Reject instead.
  const session = new AgdaSession(process.cwd());
  const dyingProc = { exitCode: null, signalCode: null, killed: false } as unknown as ChildProcess;
  session.ensureProcess = () => dyingProc;
  session["transport"].sendCommand = (async (_proc: ChildProcess, command: string) => {
    if (command.includes("Cmd_show_version")) {
      (dyingProc as unknown as { killed: boolean }).killed = true;
      throw new Error("simulated preflight timeout");
    }
    return [{ kind: "Status" }];
  }) as any;

  await expect(session.sendCommand("IOTCM cmd1")).rejects.toThrow(
    /Agda subprocess was replaced during version preflight/,
  );

  await session.destroy();
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

  await session.destroy();
});

// ── Stale-currentFile guard after a per-command timeout (PR #56) ──────────

test("a timeout that kills the proc resets currentFile so the next caller sees 'No file loaded'", async () => {
  const session = new AgdaSession(process.cwd());

  session.currentFile = "/tmp/Stale.agda";
  session.goalIds = [0, 1];
  session.lastLoadedMtime = 12345;
  session.lastClassification = "ok-with-holes";
  session.lastLoadedAt = Date.now();
  session.lastInvisibleGoalCount = 0;

  const dyingProc = { exitCode: null, signalCode: null, killed: false } as unknown as ChildProcess;
  session.ensureProcess = () => dyingProc;
  // Preflight succeeds; the USER command times out (matches the new
  // contract that timeouts reject the Promise) and marks the proc killed.
  session["transport"].sendCommand = (async (_proc: ChildProcess, command: string) => {
    if (command.includes("Cmd_show_version")) {
      return [{ kind: "DisplayInfo", info: { kind: "Version", version: "Agda version 2.9.0" } }];
    }
    (dyingProc as unknown as { killed: boolean }).killed = true;
    throw new Error("sendCommand timed out after 25ms (received 0 responses: {})");
  }) as any;

  await expect(session.sendCommand("IOTCM cmd_that_times_out")).rejects.toThrow(
    /sendCommand timed out/,
  );

  expect(session.getLoadedFile()).toBeNull();
  expect(session.getGoalIds()).toEqual([]);
  expect(session.getLastClassification()).toBeNull();
  expect(session.getLastLoadedAt()).toBeNull();

  await session.destroy();
});
