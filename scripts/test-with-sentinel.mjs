import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export function formatSentinelMessage({ label, exitCode }) {
  if (exitCode === 0) {
    return `PASSED: ${label}`;
  }

  return `FAILED: ${label} (exit code ${exitCode ?? "unknown"})`;
}

export function isMainModule(moduleUrl, argvPath) {
  if (!argvPath) {
    return false;
  }

  return moduleUrl === pathToFileURL(argvPath).href;
}

function parseArgs(argv) {
  let label = null;
  const testArgs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--label") {
      label = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    testArgs.push(arg);
  }

  return {
    label: label ?? (testArgs.length > 0 ? testArgs.join(" ") : "vitest run"),
    testArgs,
  };
}

async function main() {
  const { label, testArgs } = parseArgs(process.argv.slice(2));
  const child = spawn("npx", ["vitest", "run", ...testArgs], {
    stdio: "inherit",
    env: process.env,
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });

  console.log(formatSentinelMessage({ label, exitCode }));
  process.exit(exitCode);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
