import { spawn } from "node:child_process";

export function buildTestRunPlan() {
  return [
    { label: "build", command: "npm", args: ["run", "build"] },
    { label: "examples", command: "npm", args: ["run", "test:examples"] },
    { label: "unit", command: "node", args: ["--test", "test/unit/**/*.test.js"] },
    { label: "property", command: "npm", args: ["run", "test:property"] },
    { label: "integration", command: "npm", args: ["run", "test:integration"] },
  ];
}

export function formatRunSummary(results) {
  const failed = results.filter((result) => result.exitCode !== 0);
  const lines = ["", "=== Test Summary ==="];

  for (const result of results) {
    const status = result.exitCode === 0 ? "PASS" : "FAIL";
    lines.push(`${status} ${result.label} (exit ${result.exitCode})`);
  }

  if (failed.length === 0) {
    lines.push("PASSED: all");
  } else {
    lines.push(`FAILED: ${failed.length} group(s) failed`);
  }

  return lines.join("\n");
}

async function runCommand({ label, command, args }) {
  console.log(`\n=== Running ${label} ===`);
  console.log(`$ ${command} ${args.join(" ")}`);

  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({
        label,
        exitCode: signal ? 1 : (code ?? 1),
      });
    });
  });
}

async function main() {
  const plan = buildTestRunPlan();
  const results = [];

  for (const step of plan) {
    results.push(await runCommand(step));
  }

  console.log(formatRunSummary(results));
  process.exit(results.some((result) => result.exitCode !== 0) ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
