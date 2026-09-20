import { test, expect } from "vitest";

import {
  configuredCommandTimeoutMs,
  configuredWaitingSentryMs,
  summarizeResponseKinds,
  tailResponsePreview,
} from "../../../src/session/command-completion.js";

test("command completion configuration honors env overrides", () => {
  const previousTimeout = process.env.AGDA_MCP_COMMAND_TIMEOUT_MS;
  const previousSentry = process.env.AGDA_MCP_WAITING_SENTRY_MS;

  process.env.AGDA_MCP_COMMAND_TIMEOUT_MS = "3210";
  process.env.AGDA_MCP_WAITING_SENTRY_MS = "20000";

  try {
    expect(configuredCommandTimeoutMs()).toBe(3210);
    expect(configuredWaitingSentryMs()).toBe(20000);
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.AGDA_MCP_COMMAND_TIMEOUT_MS;
    } else {
      process.env.AGDA_MCP_COMMAND_TIMEOUT_MS = previousTimeout;
    }

    if (previousSentry === undefined) {
      delete process.env.AGDA_MCP_WAITING_SENTRY_MS;
    } else {
      process.env.AGDA_MCP_WAITING_SENTRY_MS = previousSentry;
    }
  }
});

test("summarizeResponseKinds counts response kinds", () => {
  expect(
    summarizeResponseKinds([
      { kind: "DisplayInfo" },
      { kind: "DisplayInfo" },
      { kind: "Status" },
    ]),
  ).toEqual({
    DisplayInfo: 2,
    Status: 1,
  });
});

test("tailResponsePreview returns compact trailing response summaries", () => {
  const preview = tailResponsePreview([
    { kind: "Status", status: "Running" },
    { kind: "DisplayInfo", text: "  some   spaced\ntext  " },
    { kind: "DisplayInfo", text: "x".repeat(200) },
  ], 2);

  expect(preview[0]).toEqual({
    kind: "DisplayInfo",
    text: "some spaced text",
  });
  expect(preview[1].kind).toBe("DisplayInfo");
  expect(preview[1].text).toMatch(/^x+\.\.\.$/);
  expect(preview[1].text.length).toBe(120);
});

test("tailResponsePreview stringifies structured status payloads", () => {
  const preview = tailResponsePreview([
    {
      kind: "Status",
      status: { checked: true, showImplicitArguments: false },
    },
  ]);

  expect(preview[0].kind).toBe("Status");
  expect(preview[0].status).toMatch(/"checked":true/);
});
