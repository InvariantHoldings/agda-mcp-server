import { test, expect } from "vitest";

import {
  configuredCommandTimeoutMs,
  configuredGoalTerminusIdleMs,
  configuredIdleCompletionMs,
  configuredPostStatusIdleCompletionMs,
  idleCompletionDelay,
  configuredWaitingSentryMs,
  shouldResolveOnIdle,
  summarizeResponseKinds,
  tailResponsePreview,
  trailingResponseDelay,
} from "../../../src/session/command-completion.js";

test("shouldResolveOnIdle resolves whenever a command has produced responses", () => {
  expect(
    shouldResolveOnIdle({ sawStatusDone: false, responseCount: 0, lastResponseKind: null }),
  ).toBe(false);
  expect(
    shouldResolveOnIdle({ sawStatusDone: false, responseCount: 2, lastResponseKind: "DisplayInfo" }),
  ).toBe(true);
  expect(
    shouldResolveOnIdle({ sawStatusDone: true, responseCount: 2, lastResponseKind: "Status" }),
  ).toBe(true);
  expect(
    shouldResolveOnIdle({ sawStatusDone: true, responseCount: 3, lastResponseKind: "InteractionPoints" }),
  ).toBe(true);
});

test("trailingResponseDelay prefers status completion and falls back to response-aware idle delay", () => {
  expect(
    trailingResponseDelay({ sawStatusDone: true, responseCount: 3, lastResponseKind: "InteractionPoints" }),
  ).toBe(25);
  expect(
    trailingResponseDelay({ sawStatusDone: true, responseCount: 3, lastResponseKind: "Status" }),
  ).toBe(50);
  expect(
    trailingResponseDelay({ sawStatusDone: false, responseCount: 2, lastResponseKind: "DisplayInfo" }),
  ).toBe(200);
  expect(
    trailingResponseDelay({ sawStatusDone: false, responseCount: 0, lastResponseKind: null }),
  ).toBe(0);
});

test("idleCompletionDelay waits longer after a trailing Status", () => {
  const previousIdle = process.env.AGDA_MCP_IDLE_COMPLETION_MS;
  const previousPostStatus = process.env.AGDA_MCP_POST_STATUS_IDLE_MS;

  process.env.AGDA_MCP_IDLE_COMPLETION_MS = "5";
  process.env.AGDA_MCP_POST_STATUS_IDLE_MS = "50";

  try {
    expect(configuredIdleCompletionMs()).toBe(5);
    expect(configuredPostStatusIdleCompletionMs()).toBe(50);
    expect(
      idleCompletionDelay({ sawStatusDone: true, responseCount: 1, lastResponseKind: "Status" }),
    ).toBe(50);
    expect(
      idleCompletionDelay({ sawStatusDone: true, responseCount: 2, lastResponseKind: "DisplayInfo" }),
    ).toBe(5);
  } finally {
    if (previousIdle === undefined) {
      delete process.env.AGDA_MCP_IDLE_COMPLETION_MS;
    } else {
      process.env.AGDA_MCP_IDLE_COMPLETION_MS = previousIdle;
    }

    if (previousPostStatus === undefined) {
      delete process.env.AGDA_MCP_POST_STATUS_IDLE_MS;
    } else {
      process.env.AGDA_MCP_POST_STATUS_IDLE_MS = previousPostStatus;
    }
  }
});

test("idleCompletionDelay waits for a metas Cmd_load's goal-state terminus", () => {
  const previousIdle = process.env.AGDA_MCP_IDLE_COMPLETION_MS;
  const previousTerminus = process.env.AGDA_MCP_LOAD_TERMINUS_IDLE_MS;

  process.env.AGDA_MCP_IDLE_COMPLETION_MS = "250";
  process.env.AGDA_MCP_LOAD_TERMINUS_IDLE_MS = "2000";

  try {
    expect(configuredGoalTerminusIdleMs()).toBe(2000);
    // Awaiting the terminus, not yet seen → long window regardless of the
    // last kind (the compute gap can fall after the trailing Status).
    expect(
      idleCompletionDelay({
        sawStatusDone: true,
        responseCount: 5,
        lastResponseKind: "Status",
        awaitGoalTerminus: true,
        sawGoalTerminus: false,
      }),
    ).toBe(2000);
    // Terminus observed → back to the short window.
    expect(
      idleCompletionDelay({
        sawStatusDone: true,
        responseCount: 6,
        lastResponseKind: "InteractionPoints",
        awaitGoalTerminus: true,
        sawGoalTerminus: true,
      }),
    ).toBe(250);
    // Not a metas load (e.g. Cmd_load_no_metas, give, query) → never the
    // long window even if it ends on highlighting.
    expect(
      idleCompletionDelay({
        sawStatusDone: false,
        responseCount: 4,
        lastResponseKind: "HighlightingInfo",
        awaitGoalTerminus: false,
        sawGoalTerminus: false,
      }),
    ).toBe(250);
  } finally {
    if (previousIdle === undefined) {
      delete process.env.AGDA_MCP_IDLE_COMPLETION_MS;
    } else {
      process.env.AGDA_MCP_IDLE_COMPLETION_MS = previousIdle;
    }
    if (previousTerminus === undefined) {
      delete process.env.AGDA_MCP_LOAD_TERMINUS_IDLE_MS;
    } else {
      process.env.AGDA_MCP_LOAD_TERMINUS_IDLE_MS = previousTerminus;
    }
  }
});

test("command completion configuration honors env overrides", () => {
  const previousTimeout = process.env.AGDA_MCP_COMMAND_TIMEOUT_MS;
  const previousIdle = process.env.AGDA_MCP_IDLE_COMPLETION_MS;
  const previousSentry = process.env.AGDA_MCP_WAITING_SENTRY_MS;

  process.env.AGDA_MCP_COMMAND_TIMEOUT_MS = "3210";
  process.env.AGDA_MCP_IDLE_COMPLETION_MS = "789";
  process.env.AGDA_MCP_WAITING_SENTRY_MS = "20000";

  try {
    expect(configuredCommandTimeoutMs()).toBe(3210);
    expect(configuredIdleCompletionMs()).toBe(789);
    expect(configuredWaitingSentryMs()).toBe(20000);
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.AGDA_MCP_COMMAND_TIMEOUT_MS;
    } else {
      process.env.AGDA_MCP_COMMAND_TIMEOUT_MS = previousTimeout;
    }

    if (previousIdle === undefined) {
      delete process.env.AGDA_MCP_IDLE_COMPLETION_MS;
    } else {
      process.env.AGDA_MCP_IDLE_COMPLETION_MS = previousIdle;
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
