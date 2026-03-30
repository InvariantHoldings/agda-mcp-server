import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { AgdaSession } from "../../../dist/agda-process.js";

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
    assert.equal(load.success, true);

    const result = await session.query.searchAbout("Nat");
    assert.equal(result.query, "Nat");
    assert.ok(result.results.some((entry) => entry.name === "double"));
    assert.ok(result.results.some((entry) => entry.name === "zero"));
  } finally {
    session.destroy();
  }
});

it("searchAbout returns imported definitions as well as local ones", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("SearchAboutTargets.agda");
    assert.equal(load.success, true);

    const result = await session.query.searchAbout("Maybe");
    assert.equal(result.query, "Maybe");
    assert.ok(result.results.some((entry) => entry.name === "safeHead"));
    assert.ok(result.results.some((entry) => entry.name === "mapMaybe"));
  } finally {
    session.destroy();
  }
});

it("searchAbout sees names opened from nested public modules", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("SearchAboutNestedModules.agda");
    assert.equal(load.success, true);

    const flags = await session.query.searchAbout("Flag");
    assert.equal(flags.query, "Flag");
    assert.ok(flags.results.some((entry) => entry.name === "flip"));
    assert.ok(flags.results.some((entry) => entry.name === "mapFlagMaybe"));
    assert.ok(flags.results.some((entry) => entry.name === "on"));

    const maybe = await session.query.searchAbout("Maybe");
    assert.equal(maybe.query, "Maybe");
    assert.ok(maybe.results.some((entry) => entry.name === "maybeId"));
    assert.ok(maybe.results.some((entry) => entry.name === "mapMaybe"));
  } finally {
    session.destroy();
  }
});
