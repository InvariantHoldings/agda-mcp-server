import test from "node:test";
import assert from "node:assert/strict";

import {
  configuredCommandTimeoutMs,
  configuredIdleCompletionMs,
  configuredWaitingSentryMs,
  shouldResolveOnIdle,
  summarizeResponseKinds,
  tailResponsePreview,
  trailingResponseDelay,
} from "../../../dist/session/command-completion.js";

test("shouldResolveOnIdle only resolves when responses exist without status", () => {
  assert.equal(
    shouldResolveOnIdle({ sawStatusDone: false, responseCount: 0 }),
    false,
  );
  assert.equal(
    shouldResolveOnIdle({ sawStatusDone: false, responseCount: 2 }),
    true,
  );
  assert.equal(
    shouldResolveOnIdle({ sawStatusDone: true, responseCount: 2 }),
    false,
  );
});

test("trailingResponseDelay prefers status completion and falls back to response-aware idle delay", () => {
  assert.equal(
    trailingResponseDelay({ sawStatusDone: true, responseCount: 3 }),
    50,
  );
  assert.equal(
    trailingResponseDelay({ sawStatusDone: false, responseCount: 2 }),
    200,
  );
  assert.equal(
    trailingResponseDelay({ sawStatusDone: false, responseCount: 0 }),
    0,
  );
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
