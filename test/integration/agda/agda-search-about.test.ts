import { test, expect } from "vitest";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { AgdaSession } from "../../../src/agda-process.js";

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/agda");

let agdaAvailable = false;
try {
  execSync("agda --version", { stdio: "pipe" });
  agdaAvailable = true;
} catch {
  // Agda not in PATH
}

const it = agdaAvailable && process.env.RUN_AGDA_INTEGRATION === "1"
  ? test
  : test.skip;

it("searchAbout returns local definitions for a type query", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("SearchAboutTargets.agda");
    expect(load.success).toBe(true);

    const result = await session.query.searchAbout("Nat");
    expect(result.query).toBe("Nat");
    expect(result.results.some((entry) => entry.name === "double")).toBeTruthy();
    expect(result.results.some((entry) => entry.name === "zero")).toBeTruthy();
  } finally {
    session.destroy();
  }
});

it("searchAbout returns imported definitions as well as local ones", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("SearchAboutTargets.agda");
    expect(load.success).toBe(true);

    const result = await session.query.searchAbout("Maybe");
    expect(result.query).toBe("Maybe");
    expect(result.results.some((entry) => entry.name === "safeHead")).toBeTruthy();
    expect(result.results.some((entry) => entry.name === "mapMaybe")).toBeTruthy();
  } finally {
    session.destroy();
  }
});

it("searchAbout sees names opened from nested public modules", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("SearchAboutNestedModules.agda");
    expect(load.success).toBe(true);

    const flags = await session.query.searchAbout("Flag");
    expect(flags.query).toBe("Flag");
    expect(flags.results.some((entry) => entry.name === "flip")).toBeTruthy();
    expect(flags.results.some((entry) => entry.name === "mapFlagMaybe")).toBeTruthy();
    expect(flags.results.some((entry) => entry.name === "on")).toBeTruthy();

    const maybe = await session.query.searchAbout("Maybe");
    expect(maybe.query).toBe("Maybe");
    expect(maybe.results.some((entry) => entry.name === "maybeId")).toBeTruthy();
    expect(maybe.results.some((entry) => entry.name === "mapMaybe")).toBeTruthy();
  } finally {
    session.destroy();
  }
});
