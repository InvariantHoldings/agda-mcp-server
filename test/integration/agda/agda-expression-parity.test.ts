import { test, expect } from "vitest";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { AgdaSession } from "../../../src/agda-process.js";
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

function assertIncludesAll(text: string, expected: string[], message: string) {
  for (const fragment of expected) {
    expect(text.includes(fragment)).toBeTruthy();
  }
}

for (const scenario of expressionQueryMatrix) {
  it(`expression parity: ${scenario.file}`, async () => {
    const session = new AgdaSession(FIXTURES);

    try {
      const load = await session.load(scenario.file);
      expect(load.success).toBe(true);

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

      expect(load.goals.length > 0).toBeTruthy();
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
          expect(
            result.inferredType.includes(fragment),
          ).toBeTruthy();
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
          expect(
            result.checkedExpr.includes(fragment),
          ).toBeTruthy();
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
