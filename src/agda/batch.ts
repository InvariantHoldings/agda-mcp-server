// MIT License — see LICENSE
//
// Stateless batch type-checking — runs Agda once and exits.
// Used for quick type-check without establishing an interactive session.

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { TypeCheckResult } from "./types.js";
import { findAgdaBinary } from "./session.js";

/**
 * Run Agda in batch mode (stateless, simpler).
 * Used for quick type-checking without interactive features.
 */
export async function typeCheckBatch(
  filePath: string,
  repoRoot: string,
): Promise<TypeCheckResult> {
  const agdaBin = findAgdaBinary(repoRoot);
  const absPath = resolve(filePath);

  return new Promise((resolvePromise, reject) => {
    const args = ["--safe", "--without-K", absPath];
    const proc = spawn(agdaBin, args, {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      const errors: string[] = [];
      const warnings: string[] = [];

      if (stderr.trim()) {
        for (const line of stderr.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.includes("warning") || trimmed.includes("Warning")) {
            warnings.push(trimmed);
          } else if (trimmed.length > 0) {
            errors.push(trimmed);
          }
        }
      }

      resolvePromise({
        success: code === 0,
        errors,
        warnings,
        goals: [],
        raw: [],
      });
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start Agda: ${err.message}`));
    });
  });
}
