export function incompleteFixture(name, overrides = {}) {
  return {
    name,
    expectedSuccess: true,
    expectedClassification: "ok-with-holes",
    minGoalCount: 1,
    ...overrides,
  };
}

export function completeFixture(name, overrides = {}) {
  return {
    name,
    expectedSuccess: true,
    expectedClassification: "ok-complete",
    minGoalCount: 0,
    ...overrides,
  };
}

export const fixtureMatrix = [
  incompleteFixture("WithHoles.agda"),
  incompleteFixture("MultipleHoles.agda", { minGoalCount: 2 }),
  incompleteFixture("PatternMatch.agda"),
  incompleteFixture("TrulyUnsolvable.agda"),
  incompleteFixture("HoleLambda.agda"),
  incompleteFixture("HoleQuestionMark.agda"),
  incompleteFixture("HoleRecordField.agda"),
  incompleteFixture("HoleWhereBlock.agda"),
  incompleteFixture("HoleLet.agda"),
  incompleteFixture("WithClauseHole.agda"),
  incompleteFixture("ImplicitHole.agda"),
  incompleteFixture("EqualityProofHole.agda"),

  completeFixture("Clean.agda"),
  completeFixture("EmptyModule.agda"),
  completeFixture("SafeOnly.agda"),
  completeFixture("WithWhere.agda"),
  completeFixture("Records.agda"),
  completeFixture("InstanceArgs.agda"),
  completeFixture("NestedModules.agda"),
  completeFixture("FixtureSupport.agda"),
  completeFixture("ImportedFixture.agda"),
  completeFixture("SearchAboutTargets.agda"),
];
