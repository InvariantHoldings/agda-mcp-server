import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  ["scripts/test-all-continuing.mjs"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      RUN_AGDA_INTEGRATION: "1",
      RUN_AGDA_BACKEND_INTEGRATION: "1",
      AGDA_MCP_WAITING_SENTRY_MS: process.env.AGDA_MCP_WAITING_SENTRY_MS ?? "20000",
      TEST_RUN_LOG_LABEL: process.env.TEST_RUN_LOG_LABEL ?? "release-full",
      TEST_RUN_CONSOLE: process.env.TEST_RUN_CONSOLE ?? "quiet",
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error("Failed to start full release test runner:", error);
  process.exit(1);
});
