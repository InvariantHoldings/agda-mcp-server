import { spawn } from "node:child_process";
import { mkdirSync, createWriteStream } from "node:fs";
import path from "node:path";

export function getTestLogPaths(env = process.env) {
  const logDir = env.TEST_RUN_LOG_DIR ?? "test-output";
  const label = env.TEST_RUN_LOG_LABEL ?? "integration";

  return {
    logDir,
    verbosePath: path.join(logDir, `${label}.verbose.log`),
    quietPath: path.join(logDir, `${label}.quiet.log`),
  };
}

export function buildTestRunPlan() {
  return [
    { label: "build", command: "npm", args: ["run", "--silent", "build"] },
    { label: "examples", command: process.execPath, args: ["--test", "test/examples/**/*.test.js"] },
    { label: "unit", command: process.execPath, args: ["--test", "test/unit/**/*.test.js"] },
    { label: "property", command: process.execPath, args: ["--test", "test/property/**/*.test.js"] },
    { label: "integration", command: process.execPath, args: ["--test", "test/integration/**/*.test.js"] },
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

export function isHighSignalLine(line) {
  const trimmed = line.trim();

  if (!trimmed) {
    return false;
  }

  return (
    trimmed.startsWith("✖") ||
    trimmed.startsWith("not ok") ||
    trimmed.startsWith("Warning:") ||
    trimmed.startsWith("WARNING:") ||
    trimmed.startsWith("PASS ") ||
    trimmed.startsWith("FAIL ") ||
    trimmed.startsWith("PASSED:") ||
    trimmed.startsWith("FAILED:") ||
    /^ℹ (tests|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(trimmed) ||
    /\b(warn|warning|error|failed|timed out|timeout)\b/i.test(trimmed)
  );
}

function createLinePump({ onLine }) {
  let buffered = "";

  return {
    push(chunk) {
      buffered += chunk.toString("utf8");
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";

      for (const line of lines) {
        onLine(line);
      }
    },
    flush() {
      if (buffered) {
        onLine(buffered);
        buffered = "";
      }
    },
  };
}

function writeLine(stream, line) {
  stream.write(`${line}\n`);
}

async function runCommand({ label, command, args }, reporters) {
  const header = `=== ${label} ===`;
  reporters.writeHeader(header);

  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const outputHandlers = [child.stdout, child.stderr]
    .filter(Boolean)
    .map((stream) => {
      const pump = createLinePump({
        onLine(line) {
          if (reporters.consoleMode === "verbose" || isHighSignalLine(line)) {
            reporters.writeQuiet(line);
          }
        },
      });

      stream.on("data", (chunk) => {
        if (reporters.consoleMode === "verbose") {
          process.stdout.write(chunk);
        }
        reporters.writeVerboseChunk(chunk);
        pump.push(chunk);
      });

      return pump;
    });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      for (const pump of outputHandlers) {
        pump.flush();
      }

      const exitCode = signal ? 1 : (code ?? 1);
      reporters.writeGroupResult(label, exitCode);
      resolve({
        label,
        exitCode,
      });
    });
  });
}

async function main() {
  const plan = buildTestRunPlan();
  const results = [];
  const { logDir, verbosePath, quietPath } = getTestLogPaths();
  const consoleMode = process.env.TEST_RUN_CONSOLE === "verbose" ? "verbose" : "quiet";

  mkdirSync(logDir, { recursive: true });

  const verboseStream = createWriteStream(verbosePath, { encoding: "utf8" });
  const quietStream = createWriteStream(quietPath, { encoding: "utf8" });
  const reporters = {
    consoleMode,
    writeVerbose(line) {
      writeLine(verboseStream, line);
    },
    writeVerboseChunk(chunk) {
      verboseStream.write(chunk);
    },
    writeQuiet(line) {
      writeLine(quietStream, line);
      if (consoleMode === "quiet") {
        console.log(line);
      }
    },
    writeHeader(header) {
      writeLine(verboseStream, "");
      writeLine(verboseStream, header);
      writeLine(quietStream, "");
      writeLine(quietStream, header);
      console.log(`\n${header}`);
    },
    writeGroupResult(label, exitCode) {
      const statusLine = `${exitCode === 0 ? "PASS" : "FAIL"} ${label} (exit ${exitCode})`;
      writeLine(verboseStream, statusLine);
      writeLine(quietStream, statusLine);
      console.log(statusLine);
    },
  };

  console.log(`quiet log: ${quietPath}`);
  console.log(`verbose log: ${verbosePath}`);
  writeLine(quietStream, `quiet log: ${quietPath}`);
  writeLine(quietStream, `verbose log: ${verbosePath}`);
  writeLine(verboseStream, `quiet log: ${quietPath}`);
  writeLine(verboseStream, `verbose log: ${verbosePath}`);

  for (const step of plan) {
    results.push(await runCommand(step, reporters));
  }

  const summary = formatRunSummary(results);
  writeLine(verboseStream, summary);
  writeLine(quietStream, summary);
  console.log(summary);
  await Promise.all([
    new Promise((resolve) => verboseStream.end(resolve)),
    new Promise((resolve) => quietStream.end(resolve)),
  ]);
  process.exit(results.some((result) => result.exitCode !== 0) ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
