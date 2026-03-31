import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { AgdaSession } from "../../../dist/agda-process.js";
import { navigationQueryMatrix } from "../../fixtures/agda/navigation-query-matrix.js";

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

function assertIncludesAll(text, expected, message) {
  for (const fragment of expected) {
    assert.ok(text.includes(fragment), `${message}: missing ${fragment} in ${text}`);
  }
}

for (const scenario of navigationQueryMatrix) {
  it(`navigation parity: ${scenario.file}`, async () => {
    const session = new AgdaSession(FIXTURES);

    try {
      const load = await session.load(scenario.file);
      assert.equal(load.success, true);

      if (scenario.topLevel?.whyInScope) {
        for (const query of scenario.topLevel.whyInScope) {
          const result = await session.query.whyInScopeTopLevel(query.name);
          assertIncludesAll(
            result.explanation,
            query.expectedIncludes,
            `top-level whyInScope for ${query.name} in ${scenario.file}`,
          );
        }
      }

      if (scenario.topLevel?.showModule) {
        for (const query of scenario.topLevel.showModule) {
          const result = await session.query.showModuleContentsTopLevel(query.moduleName);
          assertIncludesAll(
            result.contents,
            query.expectedIncludes,
            `top-level showModule for ${query.moduleName} in ${scenario.file}`,
          );
        }
      }

      if (!scenario.goal) {
        return;
      }

      assert.ok(load.goals.length > 0, `expected at least one goal in ${scenario.file}`);
      const goalId = load.goals[0].goalId;

      if (scenario.goal.whyInScope) {
        for (const query of scenario.goal.whyInScope) {
          const result = await session.query.whyInScope(goalId, query.name);
          assertIncludesAll(
            result.explanation,
            query.expectedIncludes,
            `goal whyInScope for ${query.name} in ${scenario.file}`,
          );
        }
      }

      if (scenario.goal.showModule) {
        for (const query of scenario.goal.showModule) {
          const result = await session.query.showModuleContents(goalId, query.moduleName);
          assertIncludesAll(
            result.contents,
            query.expectedIncludes,
            `goal showModule for ${query.moduleName} in ${scenario.file}`,
          );
        }
      }

      if (scenario.goal.elaborate) {
        for (const query of scenario.goal.elaborate) {
          const result = await session.query.elaborate(goalId, query.expr);
          assertIncludesAll(
            result.elaboration,
            query.expectedIncludes,
            `elaborate for ${query.expr} in ${scenario.file}`,
          );
        }
      }

      if (scenario.goal.helperFunction) {
        for (const query of scenario.goal.helperFunction) {
          const result = await session.query.helperFunction(goalId, query.expr);
          assertIncludesAll(
            result.helperType,
            query.expectedIncludes,
            `helper function for ${query.expr} in ${scenario.file}`,
          );
        }
      }
    } finally {
      session.destroy();
    }
  });
}

it("showVersion returns a version string from the live Agda process", async () => {
  const session = new AgdaSession(FIXTURES);

  try {
    const result = await session.query.showVersion();
    assert.match(result.version, /[0-9]+\.[0-9]+/);
  } finally {
    session.destroy();
  }
});
