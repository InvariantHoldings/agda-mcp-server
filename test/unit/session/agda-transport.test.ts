import { test, expect } from "vitest";
import type { ChildProcess } from "node:child_process";

import { AgdaTransport } from "../../../src/session/agda-transport.js";

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

test("AgdaTransport waits for terminal payloads after Status before resolving", async () => {
  await withEnv("AGDA_MCP_IDLE_COMPLETION_MS", "5", async () => {
    const transport = new AgdaTransport();
    let wrote = false;

    const proc = {
      stdin: {
        write() {
          wrote = true;
          setTimeout(() => {
            transport.handleStdout(Buffer.from("JSON> {\"kind\":\"Status\",\"status\":{\"checked\":true}}\n"));
          }, 0);
          setTimeout(() => {
            transport.handleStdout(Buffer.from("JSON> {\"kind\":\"DisplayInfo\",\"info\":{\"kind\":\"CurrentGoal\",\"goal\":\"Nat\"}}\n"));
          }, 15);
          setTimeout(() => {
            transport.handleStdout(Buffer.from("JSON> {\"kind\":\"InteractionPoints\",\"interactionPoints\":[0]}\n"));
          }, 20);
        },
      },
    };

    const responses = await transport.sendCommand(proc as unknown as ChildProcess, "IOTCM \"x\" NonInteractive Direct (Cmd_load)", 100);

    expect(wrote).toBe(true);
    expect(
      responses.map((response) => response.kind),
    ).toEqual(["Status", "DisplayInfo", "InteractionPoints"]);
  });
});

test("AgdaTransport resolves after trailing Status when earlier payloads already arrived", async () => {
  await withEnv("AGDA_MCP_IDLE_COMPLETION_MS", "5", async () => {
    const transport = new AgdaTransport();

    const proc = {
      stdin: {
        write() {
          setTimeout(() => {
            transport.handleStdout(Buffer.from("JSON> {\"kind\":\"DisplayInfo\",\"info\":{\"kind\":\"CurrentGoal\",\"goal\":\"Nat\"}}\n"));
          }, 0);
          setTimeout(() => {
            transport.handleStdout(Buffer.from("JSON> {\"kind\":\"HighlightingInfo\",\"payload\":[]}\n"));
          }, 5);
          setTimeout(() => {
            transport.handleStdout(Buffer.from("JSON> {\"kind\":\"Status\",\"status\":{\"checked\":false}}\n"));
          }, 10);
        },
      },
    };

    const responses = await transport.sendCommand(proc as unknown as ChildProcess, "IOTCM \"x\" NonInteractive Direct (Cmd_load)", 100);

    expect(
      responses.map((response) => response.kind),
    ).toEqual(["DisplayInfo", "HighlightingInfo", "Status"]);
  });
});

test("AgdaTransport resolves status-only commands without timing out", async () => {
  await withEnv("AGDA_MCP_IDLE_COMPLETION_MS", "5", async () => {
    const transport = new AgdaTransport();

    const proc = {
      stdin: {
        write() {
          setTimeout(() => {
            transport.handleStdout(Buffer.from("JSON> {\"kind\":\"Status\",\"status\":{\"checked\":true}}\n"));
          }, 0);
        },
      },
    };

    const responses = await transport.sendCommand(proc as unknown as ChildProcess, "IOTCM \"x\" NonInteractive Direct (ShowImplicitArgs True)", 100);

    expect(
      responses.map((response) => response.kind),
    ).toEqual(["Status"]);
  });
});

test("AgdaTransport.destroy unblocks an in-flight sendCommand instead of leaving it waiting on its timeout", async () => {
  // Regression for Copilot review comment on PR #56 (0.6.7 cleanup):
  // when `session.destroy()` ran while a command was in flight, the
  // proc listeners were detached before termination so the
  // subprocess's eventual `close` never reached the emitter; the
  // command's done listener never fired and the caller would wait
  // for the full per-command timeout (default 120 s) before observing
  // the shutdown. Fix: `transport.destroy()` now emits `"error"` on
  // the shared emitter so the in-flight sendCommand rejects promptly.
  const transport = new AgdaTransport();
  const proc = {
    stdin: { write() { /* no traffic — would otherwise time out at 60s */ } },
  };

  const pending = transport.sendCommand(
    proc as unknown as ChildProcess,
    "IOTCM \"x\" NonInteractive Direct (Cmd_load)",
    60_000,
  );

  // Give Node a microtask tick so sendCommand has registered its
  // listeners on the emitter before destroy() emits "error".
  await Promise.resolve();

  const startedAt = Date.now();
  transport.destroy();

  await expect(pending).rejects.toThrow(/destroyed while command was in flight/);
  // Must reject promptly (well under the per-command timeout).
  expect(Date.now() - startedAt).toBeLessThan(1_000);
});

test("sendFireAndForgetCommand interrupts an in-flight sendCommand by rejecting it", async () => {
  // Cmd_abort / Cmd_exit share the transport's mutable buffer +
  // responseQueue + collecting state with regular sendCommand. If a
  // normal command is in flight and the user fires agda_abort, the
  // fire-and-forget path used to clobber that state and let the
  // in-flight command's responses fall on the floor — leaving the
  // original Promise to time out after the full per-command budget.
  // The fix routes through `rejectInFlightCommand` so the active
  // sendCommand rejects promptly, matching the IOTCM protocol
  // intent of Cmd_abort (which is supposed to *interrupt* the
  // active command, not wait its turn behind it).
  const transport = new AgdaTransport();
  const proc = { stdin: { write() { /* no traffic */ } } } as unknown as ChildProcess;

  const pending = transport.sendCommand(
    proc,
    "IOTCM \"x\" NonInteractive Direct (Cmd_load)",
    60_000,
  );

  // Yield so sendCommand registers its done/error listeners on the
  // shared emitter before the control command fires.
  await Promise.resolve();

  const startedAt = Date.now();
  const fireResult = transport.sendFireAndForgetCommand(
    proc,
    "IOTCM \"x\" NonInteractive Direct (Cmd_abort)",
    { flushMs: 50, escalationMs: 0 },
  );

  await expect(pending).rejects.toThrow(/Interrupted by Agda control command/);
  await fireResult;
  expect(Date.now() - startedAt).toBeLessThan(500);
});

test("sendFireAndForgetCommand resolves (not rejects) when the transport emitter emits 'error' during the flush window", async () => {
  // Regression for Copilot review on PR #56 (round 6 /
  // `agda-transport.ts:125`): the previous fire-and-forget path
  // installed no `error` listener on the shared emitter. If the
  // subprocess (or a concurrent `destroy()`) emitted `error` while
  // the flush timer was pending, Node throws on the unhandled
  // emitter event and crashes the server. The fix attaches an
  // `error` listener that *resolves* the Promise with the responses
  // collected so far — fire-and-forget contract is "never reject".
  const transport = new AgdaTransport();
  const proc = {
    stdin: { write() { /* discard */ } },
  } as unknown as ChildProcess;

  const pending = transport.sendFireAndForgetCommand(proc, "IOTCM control", { flushMs: 50, escalationMs: 0 });

  // Yield so the listener is registered before we emit.
  await Promise.resolve();

  // Simulate a late spawn error reaching the transport during flush.
  transport.emitter.emit("error", new Error("late proc failure"));

  // Must resolve, not reject — and must do so quickly (well before
  // the 50ms flush would have completed on its own).
  const startedAt = Date.now();
  await expect(pending).resolves.toEqual([]);
  expect(Date.now() - startedAt).toBeLessThan(40);
});

test("sendFireAndForgetCommand terminates a wedged proc that never acknowledges the control command", async () => {
  // Regression for Copilot review on PR #56 (round 9 J1 —
  // `session-command-dispatch.ts:109`): rejecting the in-flight
  // sendCommand cancelled its per-command kill-on-timeout, but the
  // follow-up fire-and-forget control command only waited a short
  // flush window. A wedged Agda that fails to service Cmd_abort /
  // Cmd_exit would then have nothing reap it, leaving the same
  // CPU-burning subprocess alive — exactly the leak this PR is
  // meant to close. The fix arms a kill-escalation timer that
  // calls terminateAgdaProcess after `escalationMs` if the proc
  // hasn't exited.
  //
  // Round 10 K1 tightened the gate: escalation arms only when
  // there's an in-flight sendCommand to interrupt, so this test
  // parks one first (the realistic shape — abort is meaningful
  // because something was running).
  const transport = new AgdaTransport();
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];

  const proc: Partial<ChildProcess> & {
    stdin: { write(): void };
    once(event: string, listener: (...args: unknown[]) => void): unknown;
    kill(signal?: NodeJS.Signals | number): boolean;
  } = {
    exitCode: null,
    signalCode: null,
    killed: false,
    stdin: { write() { /* never delivers a response — proc is wedged */ } },
    once(_event: string, _listener: (...args: unknown[]) => void) {
      return proc as unknown as ChildProcess;
    },
    kill(signal?: NodeJS.Signals | number) {
      killSignals.push(signal);
      (proc as { killed: boolean }).killed = true;
      return true;
    },
  };

  // Park a regular sendCommand so the abort actually has something
  // to interrupt. Attach the rejection expectation BEFORE yielding
  // so the unhandled-rejection tracker is satisfied even if the
  // microtask scheduling raced us.
  const inFlight = transport.sendCommand(
    proc as unknown as ChildProcess,
    "IOTCM \"x\" NonInteractive Direct (Cmd_load)",
    60_000,
  );
  const inFlightRejection = expect(inFlight).rejects.toThrow(/Interrupted by Agda control command/);
  await Promise.resolve();

  await transport.sendFireAndForgetCommand(
    proc as unknown as ChildProcess,
    "IOTCM \"x\" NonInteractive Direct (Cmd_abort)",
    { flushMs: 30, escalationMs: 60 },
  );
  await inFlightRejection;

  // The Promise itself resolves promptly (after flushMs) — the
  // tool layer must not wait on the wedged proc. But the
  // escalation timer keeps running in the background.
  expect(killSignals).toEqual([]);

  // Wait long enough for the escalation to fire (escalationMs +
  // a small buffer; the timer is unref'd but still runs).
  await new Promise((resolve) => setTimeout(resolve, 120));

  // SIGTERM should have been delivered to the wedged proc.
  expect(killSignals).toContain("SIGTERM");
});

test("sendFireAndForgetCommand does NOT arm the escalation when no command was in flight (idle-session abort is a no-op)", async () => {
  // Regression for Copilot review on PR #56 (round 10 K1 —
  // `agda-transport.ts:188`): the previous implementation armed the
  // 5s escalation timer unconditionally. `Cmd_abort` on an idle
  // session is a legitimate no-op (no in-flight command to cancel,
  // no `DoneAborting` echo); the escalation would still fire after
  // 5s and SIGTERM a perfectly healthy session. The fix: arm only
  // when `rejectInFlightCommand` reports there was actually an
  // active sendCommand to interrupt.
  const transport = new AgdaTransport();
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];

  const proc: Partial<ChildProcess> & {
    stdin: { write(): void };
    once(event: string, listener: () => void): unknown;
    kill(signal?: NodeJS.Signals | number): boolean;
  } = {
    exitCode: null,
    signalCode: null,
    killed: false,
    stdin: { write() { /* idle session — no response, no in-flight */ } },
    once(_event: string, _listener: () => void) {
      return proc as unknown as ChildProcess;
    },
    kill(signal?: NodeJS.Signals | number) {
      killSignals.push(signal);
      return true;
    },
  };

  // No prior `sendCommand` ran, so the emitter has no `error`
  // listener — `rejectInFlightCommand` returns false and the
  // escalation timer must NOT be armed.
  await transport.sendFireAndForgetCommand(
    proc as unknown as ChildProcess,
    "IOTCM \"x\" NonInteractive Direct (Cmd_abort)",
    { flushMs: 20, escalationMs: 60 },
  );

  // Wait past the escalation budget to prove the timer never fired.
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(killSignals).toEqual([]);
});

test("sendFireAndForgetCommand clears the escalation timer once Agda emits DoneAborting (healthy-but-stays-alive abort)", async () => {
  // Companion regression for round 10 K1: when abort interrupts an
  // in-flight command AND Agda actually services it (emitting
  // DoneAborting) and continues running — the proc never closes —
  // the previous implementation would still fire the escalation
  // timer 5s later and kill the healthy session. The fix observes
  // DoneAborting/DoneExiting in `recordCollectedResponse` while
  // `currentCommandKind === "control"` and clears the timer there.
  const transport = new AgdaTransport();
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];

  let closeListener: (() => void) | null = null;
  const proc: Partial<ChildProcess> & {
    stdin: { write(): void };
    once(event: string, listener: () => void): unknown;
    kill(signal?: NodeJS.Signals | number): boolean;
  } = {
    exitCode: null,
    signalCode: null,
    killed: false,
    stdin: { write() {
      // Agda services the abort and emits DoneAborting promptly,
      // then stays alive serving subsequent commands.
      setTimeout(() => {
        transport.handleStdout(Buffer.from("JSON> {\"kind\":\"DoneAborting\"}\n"));
      }, 0);
    } },
    once(event: string, listener: () => void) {
      if (event === "close") closeListener = listener;
      return proc as unknown as ChildProcess;
    },
    kill(signal?: NodeJS.Signals | number) {
      killSignals.push(signal);
      return true;
    },
  };

  // Park a regular sendCommand so rejectInFlightCommand has
  // something to actually interrupt — that's what arms the
  // escalation timer in the first place. Attach the rejection
  // expectation BEFORE yielding so Node's unhandled-rejection
  // tracker is satisfied no matter how microtasks schedule.
  const inFlight = transport.sendCommand(
    proc as unknown as ChildProcess,
    "IOTCM \"x\" NonInteractive Direct (Cmd_load)",
    60_000,
  );
  const inFlightRejection = expect(inFlight).rejects.toThrow(/Interrupted by Agda control command/);
  await Promise.resolve();

  await transport.sendFireAndForgetCommand(
    proc as unknown as ChildProcess,
    "IOTCM \"x\" NonInteractive Direct (Cmd_abort)",
    { flushMs: 30, escalationMs: 80 },
  );
  await inFlightRejection;

  // Wait past the escalation budget. The proc NEVER closed — only
  // the DoneAborting echo arrived. The escalation must have been
  // cleared by the echo, so no SIGTERM should be sent.
  await new Promise((resolve) => setTimeout(resolve, 140));
  expect(closeListener).not.toBeNull();
  expect(killSignals).toEqual([]);
});

test("sendFireAndForgetCommand does NOT terminate a proc that exits cleanly during the escalation budget", async () => {
  const transport = new AgdaTransport();
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];

  let closeListener: (() => void) | null = null;
  const proc: Partial<ChildProcess> & {
    stdin: { write(): void };
    once(event: string, listener: () => void): unknown;
    kill(signal?: NodeJS.Signals | number): boolean;
  } = {
    exitCode: null,
    signalCode: null,
    killed: false,
    stdin: { write() { /* discard */ } },
    once(event: string, listener: () => void) {
      if (event === "close") closeListener = listener;
      return proc as unknown as ChildProcess;
    },
    kill(signal?: NodeJS.Signals | number) {
      killSignals.push(signal);
      return true;
    },
  };

  await transport.sendFireAndForgetCommand(
    proc as unknown as ChildProcess,
    "IOTCM \"x\" NonInteractive Direct (Cmd_exit)",
    { flushMs: 20, escalationMs: 80 },
  );

  // Proc exits cleanly before the escalation budget.
  (proc as { exitCode: number | null }).exitCode = 0;
  closeListener?.();

  await new Promise((resolve) => setTimeout(resolve, 120));

  expect(killSignals).toEqual([]);
});

test("late DoneAborting echo arriving during a subsequent regular sendCommand does not corrupt its responseQueue", async () => {
  // Regression for Copilot review on PR #56 (round 9 J2 —
  // `agda-transport.ts:164`): after the fire-and-forget flush
  // window closes a delayed DoneAborting / DoneExiting can still
  // hit the stdout pipe. Without `currentCommandKind` filtering it
  // would land in the NEXT regular command's responseQueue and
  // either appear as a spurious response or trip idle completion
  // for it. The fix drops control-only kinds (DoneAborting,
  // DoneExiting) when the current command kind is "regular".
  await withEnv("AGDA_MCP_IDLE_COMPLETION_MS", "5", async () => {
    const transport = new AgdaTransport();
    const proc = {
      stdin: { write() {
        // Inject a late DoneAborting before the legitimate response —
        // simulates an echo that beat the regular command's first
        // protocol message.
        setTimeout(() => {
          transport.handleStdout(Buffer.from("JSON> {\"kind\":\"DoneAborting\"}\n"));
        }, 0);
        setTimeout(() => {
          transport.handleStdout(Buffer.from("JSON> {\"kind\":\"DisplayInfo\",\"info\":{\"kind\":\"CurrentGoal\",\"goal\":\"Nat\"}}\n"));
        }, 5);
        setTimeout(() => {
          transport.handleStdout(Buffer.from("JSON> {\"kind\":\"Status\",\"status\":{\"checked\":false}}\n"));
        }, 10);
      } },
    };

    const responses = await transport.sendCommand(
      proc as unknown as ChildProcess,
      "IOTCM \"x\" NonInteractive Direct (Cmd_goal_type)",
      200,
    );

    // DoneAborting must be filtered out — only the real responses
    // should reach the caller.
    expect(responses.map((r) => r.kind)).toEqual(["DisplayInfo", "Status"]);
  });
});

test("handleStdout drops chunks that arrive while not collecting", () => {
  // After a per-command timeout fires `finish()` sets `collecting = false`
  // but the killed proc's stdout listener stays attached until the
  // next `ensureProcess()` detaches it. Late chunks from the dying
  // child must NOT accumulate in `this.buffer` — otherwise the first
  // JSON line emitted by the replacement Agda concatenates with the
  // stale fragment and gets misparsed by `drainBuffer`.
  const transport = new AgdaTransport();

  expect(transport.collecting).toBe(false);
  transport.handleStdout(Buffer.from("partial-line-from-dying-proc"));
  expect(transport.buffer).toBe("");
});

test("sendCommand timeout kills the subprocess AND rejects the Promise", async () => {
  const transport = new AgdaTransport();
  const killCalls: Array<NodeJS.Signals | number | undefined> = [];

  const proc: Partial<ChildProcess> & {
    stdin: { write(): void };
    once(event: string, listener: (...args: unknown[]) => void): unknown;
  } = {
    exitCode: null,
    signalCode: null,
    killed: false,
    stdin: { write() { /* discard */ } },
    kill(signal?: NodeJS.Signals | number) {
      killCalls.push(signal);
      (proc as { killed: boolean }).killed = true;
      (proc as { exitCode: number | null }).exitCode = 143;
      return true;
    },
    once(_event: string, _listener: (...args: unknown[]) => void) {
      return proc as unknown as ChildProcess;
    },
  };

  await expect(
    transport.sendCommand(
      proc as unknown as ChildProcess,
      "IOTCM \"x\" NonInteractive Direct (Cmd_load)",
      25,
    ),
  ).rejects.toThrow(/sendCommand timed out after 25ms/);
  expect(killCalls).toEqual(["SIGTERM"]);
});

test("AgdaTransport captures prompt notices as stderr output while collecting", async () => {
  await withEnv("AGDA_MCP_IDLE_COMPLETION_MS", "5", async () => {
    const transport = new AgdaTransport();

    const proc = {
      stdin: {
        write() {
          setTimeout(() => {
            transport.handleStdout(Buffer.from("JSON> compiling...\n"));
          }, 0);
          setTimeout(() => {
            transport.handleStdout(Buffer.from("JSON> {\"kind\":\"DisplayInfo\",\"info\":{\"kind\":\"CurrentGoal\",\"goal\":\"Nat\"}}\n"));
          }, 5);
        },
      },
    };

    const responses = await transport.sendCommand(proc as unknown as ChildProcess, "IOTCM \"x\" NonInteractive Direct (Cmd_goal_type)", 100);

    expect(
      responses.map((response) => response.kind),
    ).toEqual(["StderrOutput", "DisplayInfo"]);
    expect(String(responses[0].text)).toMatch(/compiling/);
  });
});
