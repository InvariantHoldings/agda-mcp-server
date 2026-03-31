import test from "node:test";
import assert from "node:assert/strict";

import { AgdaTransport } from "../../../dist/session/agda-transport.js";

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

    const responses = await transport.sendCommand(proc, "IOTCM \"x\" NonInteractive Direct (Cmd_load)", 100);

    assert.equal(wrote, true);
    assert.deepEqual(
      responses.map((response) => response.kind),
      ["Status", "DisplayInfo", "InteractionPoints"],
    );
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

    const responses = await transport.sendCommand(proc, "IOTCM \"x\" NonInteractive Direct (Cmd_goal_type)", 100);

    assert.deepEqual(
      responses.map((response) => response.kind),
      ["StderrOutput", "DisplayInfo"],
    );
    assert.match(String(responses[0].text), /compiling/);
  });
});
