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

test("AgdaTransport kills the subprocess when sendCommand times out", async () => {
  // Regression for the resource leak fixed in 0.6.7: the timeout handler
  // resolved the Promise without killing the underlying Agda
  // process, leaving a zombie burning CPU until the session was
  // explicitly destroyed. The fix calls `terminateAgdaProcess`
  // from inside the timeout handler so the kernel always reaps
  // the wedged child.
  const transport = new AgdaTransport();
  const killCalls: Array<NodeJS.Signals | number | undefined> = [];

  // Mock proc: no stdout traffic ever arrives, so sendCommand is
  // forced into its timeout branch. We capture .kill() calls and
  // simulate the kernel acknowledging the SIGTERM by flipping the
  // exit fields — that prevents the SIGKILL escalation timer in
  // `terminateAgdaProcess` from firing during the test.
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

  const responses = await transport.sendCommand(
    proc as unknown as ChildProcess,
    "IOTCM \"x\" NonInteractive Direct (Cmd_load)",
    25,
  );

  expect(responses).toEqual([]);
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
