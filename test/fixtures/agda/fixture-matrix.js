export function incompleteFixture(name, overrides = {}) {
  return {
    name,
    expectedSuccess: true,
    expectedClassification: "ok-with-holes",
    minVisibleGoalCount: 1,
    minHoleCount: 1,
    expectedStrictSuccess: false,
    expectedStrictClassification: "type-error",
    ...overrides,
  };
}

export function completeFixture(name, overrides = {}) {
  return {
    name,
    expectedSuccess: true,
    expectedClassification: "ok-complete",
    minVisibleGoalCount: 0,
    minHoleCount: 0,
    expectedStrictSuccess: true,
    expectedStrictClassification: "ok-complete",
    ...overrides,
  };
}

export function errorFixture(name, overrides = {}) {
  return {
    name,
    expectedSuccess: false,
    expectedClassification: "type-error",
    minVisibleGoalCount: 0,
    minHoleCount: 0,
    expectedStrictSuccess: false,
    expectedStrictClassification: "type-error",
    ...overrides,
  };
}

export const fixtureMatrix = [
  incompleteFixture("WithHoles.agda"),
  incompleteFixture("MultipleHoles.agda", { minVisibleGoalCount: 2, minHoleCount: 2 }),
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
  incompleteFixture("ImportedContextHole.agda"),
  incompleteFixture("QualifiedImportedHole.agda"),

  completeFixture("Clean.agda"),
  completeFixture("EmptyModule.agda"),
  completeFixture("SafeOnly.agda"),
  completeFixture("WithWhere.agda"),
  completeFixture("Records.agda"),
  completeFixture("InstanceArgs.agda"),
  completeFixture("NestedModules.agda"),
  completeFixture("FixtureSupport.agda"),
  completeFixture("ImportedFixture.agda"),
  completeFixture("MultiFileImports.agda"),
  completeFixture("TransitiveImport.agda"),
  completeFixture("SearchAboutTargets.agda"),
  incompleteFixture("InferredMeta.agda", { minVisibleGoalCount: 0 }),

  errorFixture("ImportedTypeError.agda"),
  incompleteFixture("WithAbstract.agda", { minVisibleGoalCount: 0 }),
];
