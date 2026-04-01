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
