import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { AgdaSession } from "../../../dist/agda-process.js";
import { expressionQueryMatrix } from "../../fixtures/agda/expression-query-matrix.js";

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

for (const scenario of expressionQueryMatrix) {
  it(`expression parity: ${scenario.file}`, async () => {
    const session = new AgdaSession(FIXTURES);

    try {
      const load = await session.load(scenario.file);
      assert.equal(load.success, true);

      if (scenario.topLevelCompute) {
        const computed = await session.expr.computeTopLevel(scenario.topLevelCompute.expr);
        assertIncludesAll(
          computed.normalForm,
          scenario.topLevelCompute.expectedIncludes,
          `top-level compute for ${scenario.file}`,
        );
      }

      if (scenario.topLevelInfer) {
        const inferred = await session.expr.inferTopLevel(scenario.topLevelInfer.expr);
        assertIncludesAll(
          inferred.type,
          scenario.topLevelInfer.expectedIncludes,
          `top-level infer for ${scenario.file}`,
        );
      }

      if (!scenario.goal) {
        return;
      }

      assert.ok(load.goals.length > 0, `expected at least one goal in ${scenario.file}`);
      const goalId = load.goals[0].goalId;

      const context = await session.goal.context(goalId);
      if (scenario.goal.contextIncludes) {
        assertIncludesAll(
          context.context.join("\n"),
          scenario.goal.contextIncludes,
          `context for ${scenario.file}`,
        );
      }

      if (scenario.goal.compute) {
        const computed = await session.expr.compute(goalId, scenario.goal.compute.expr);
        assertIncludesAll(
          computed.normalForm,
          scenario.goal.compute.expectedIncludes,
          `goal compute for ${scenario.file}`,
        );
      }

      if (scenario.goal.infer) {
        const inferred = await session.expr.infer(goalId, scenario.goal.infer.expr);
        assertIncludesAll(
          inferred.type,
          scenario.goal.infer.expectedIncludes,
          `goal infer for ${scenario.file}`,
        );
      }

      if (scenario.goal.goalTypeContextInfer) {
        const result = await session.query.goalTypeContextInfer(
          goalId,
          scenario.goal.goalTypeContextInfer.expr,
        );
        assertIncludesAll(
          result.goalType,
          scenario.goal.goalTypeContextInfer.goalTypeIncludes,
          `goal type for infer in ${scenario.file}`,
        );
        for (const fragment of scenario.goal.goalTypeContextInfer.inferredTypeIncludes) {
          assert.ok(
            result.inferredType.includes(fragment),
            `inferred type for ${scenario.file}: missing ${fragment} in ${result.inferredType}`,
          );
        }
        if (scenario.goal.goalTypeContextInfer.contextIncludes) {
          assertIncludesAll(
            result.context.join("\n"),
            scenario.goal.goalTypeContextInfer.contextIncludes,
            `goal type/context infer context for ${scenario.file}`,
          );
        }
      }

      if (scenario.goal.goalTypeContextCheck) {
        const result = await session.goal.typeContextCheck(
          goalId,
          scenario.goal.goalTypeContextCheck.expr,
        );
        assertIncludesAll(
          result.goalType,
          scenario.goal.goalTypeContextCheck.goalTypeIncludes,
          `goal type for check in ${scenario.file}`,
        );
        for (const fragment of scenario.goal.goalTypeContextCheck.checkedExprIncludes) {
          assert.ok(
            result.checkedExpr.includes(fragment),
            `checked expr for ${scenario.file}: missing ${fragment} in ${result.checkedExpr}`,
          );
        }
        if (scenario.goal.goalTypeContextCheck.contextIncludes) {
          assertIncludesAll(
            result.context.join("\n"),
            scenario.goal.goalTypeContextCheck.contextIncludes,
            `goal type/context check context for ${scenario.file}`,
          );
        }
      }
    } finally {
      session.destroy();
    }
  });
}
