import test from "node:test";
import assert from "node:assert/strict";

import {
  configuredCommandTimeoutMs,
  configuredIdleCompletionMs,
  configuredPostStatusIdleCompletionMs,
  idleCompletionDelay,
  configuredWaitingSentryMs,
  shouldResolveOnIdle,
  summarizeResponseKinds,
  tailResponsePreview,
  trailingResponseDelay,
} from "../../../dist/session/command-completion.js";

test("shouldResolveOnIdle resolves whenever a command has produced responses", () => {
  assert.equal(
    shouldResolveOnIdle({ sawStatusDone: false, responseCount: 0, lastResponseKind: null }),
    false,
  );
  assert.equal(
    shouldResolveOnIdle({ sawStatusDone: false, responseCount: 2, lastResponseKind: "DisplayInfo" }),
    true,
  );
  assert.equal(
    shouldResolveOnIdle({ sawStatusDone: true, responseCount: 2, lastResponseKind: "Status" }),
    true,
  );
  assert.equal(
    shouldResolveOnIdle({ sawStatusDone: true, responseCount: 3, lastResponseKind: "InteractionPoints" }),
    true,
  );
});

test("trailingResponseDelay prefers status completion and falls back to response-aware idle delay", () => {
  assert.equal(
    trailingResponseDelay({ sawStatusDone: true, responseCount: 3, lastResponseKind: "InteractionPoints" }),
    25,
  );
  assert.equal(
    trailingResponseDelay({ sawStatusDone: true, responseCount: 3, lastResponseKind: "Status" }),
    50,
  );
  assert.equal(
    trailingResponseDelay({ sawStatusDone: false, responseCount: 2, lastResponseKind: "DisplayInfo" }),
    200,
  );
  assert.equal(
    trailingResponseDelay({ sawStatusDone: false, responseCount: 0, lastResponseKind: null }),
    0,
  );
});

test("idleCompletionDelay waits longer after a trailing Status", () => {
  const previousIdle = process.env.AGDA_MCP_IDLE_COMPLETION_MS;
  const previousPostStatus = process.env.AGDA_MCP_POST_STATUS_IDLE_MS;

  process.env.AGDA_MCP_IDLE_COMPLETION_MS = "5";
  process.env.AGDA_MCP_POST_STATUS_IDLE_MS = "50";

  try {
    assert.equal(configuredIdleCompletionMs(), 5);
    assert.equal(configuredPostStatusIdleCompletionMs(), 50);
    assert.equal(
      idleCompletionDelay({ sawStatusDone: true, responseCount: 1, lastResponseKind: "Status" }),
      50,
    );
    assert.equal(
      idleCompletionDelay({ sawStatusDone: true, responseCount: 2, lastResponseKind: "DisplayInfo" }),
      5,
    );
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

test("command completion configuration honors env overrides", () => {
  const previousTimeout = process.env.AGDA_MCP_COMMAND_TIMEOUT_MS;
  const previousIdle = process.env.AGDA_MCP_IDLE_COMPLETION_MS;
  const previousSentry = process.env.AGDA_MCP_WAITING_SENTRY_MS;

  process.env.AGDA_MCP_COMMAND_TIMEOUT_MS = "3210";
  process.env.AGDA_MCP_IDLE_COMPLETION_MS = "789";
  process.env.AGDA_MCP_WAITING_SENTRY_MS = "20000";

  try {
    assert.equal(configuredCommandTimeoutMs(), 3210);
    assert.equal(configuredIdleCompletionMs(), 789);
    assert.equal(configuredWaitingSentryMs(), 20000);
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
  assert.deepEqual(
    summarizeResponseKinds([
      { kind: "DisplayInfo" },
      { kind: "DisplayInfo" },
      { kind: "Status" },
    ]),
    {
      DisplayInfo: 2,
      Status: 1,
    },
  );
});

test("tailResponsePreview returns compact trailing response summaries", () => {
  const preview = tailResponsePreview([
    { kind: "Status", status: "Running" },
    { kind: "DisplayInfo", text: "  some   spaced\ntext  " },
    { kind: "DisplayInfo", text: "x".repeat(200) },
  ], 2);

  assert.deepEqual(preview[0], {
    kind: "DisplayInfo",
    text: "some spaced text",
  });
  assert.equal(preview[1].kind, "DisplayInfo");
  assert.match(preview[1].text, /^x+\.\.\.$/);
  assert.equal(preview[1].text.length, 120);
});

test("tailResponsePreview stringifies structured status payloads", () => {
  const preview = tailResponsePreview([
    {
      kind: "Status",
      status: { checked: true, showImplicitArguments: false },
    },
  ]);

  assert.equal(preview[0].kind, "Status");
  assert.match(preview[0].status, /"checked":true/);
});
