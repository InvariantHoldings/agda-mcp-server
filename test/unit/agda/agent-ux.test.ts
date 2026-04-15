import { describe, expect, test } from "vitest";

import {
  applyScopedRename,
  buildAutoSearchPayload,
  buildMissingClause,
  classifyAgdaError,
  extractPostulateSites,
  extractSuggestedRename,
  inferFixityConflicts,
  inferMissingClauseArity,
  matchesTypePattern,
  parseAgdaLibFlags,
  parseModuleSourceShape,
  parseOptionsPragmas,
  parseTopLevelDefinitions,
  rewriteCompilerPlaceholders,
} from "../../../src/agda/agent-ux.js";

describe("rewriteCompilerPlaceholders", () => {
  test("rewrites uppercase extension placeholders", () => {
    const input = "where .AGDA denotes a legal extension; also .LAGDA.MD";
    expect(rewriteCompilerPlaceholders(input)).toContain("<ext>");
    expect(rewriteCompilerPlaceholders(input)).not.toContain(".AGDA");
  });
});

describe("extractSuggestedRename", () => {
  test("extracts quoted did-you-mean suggestions", () => {
    const message = "Module X doesn't export foo. Did you mean `bar`?";
    expect(extractSuggestedRename(message)).toBe("bar");
  });
});

describe("classifyAgdaError", () => {
  test("classifies rename hints as mechanical-rename", () => {
    const out = classifyAgdaError(
      "Module Foo doesn't export proj1. Did you mean `proj₁`?",
    );
    expect(out.category).toBe("mechanical-rename");
    expect(out.suggestedRename).toBe("proj₁");
  });

  test("classifies parse failures as parser-regression", () => {
    const out = classifyAgdaError("Parse error at line 4");
    expect(out.category).toBe("parser-regression");
  });
});

describe("applyScopedRename", () => {
  test("renames identifiers with boundaries", () => {
    const source = "foo : Set\nfoobar : Set\nfoo = foobar\n";
    const out = applyScopedRename(source, "foo", "bar");
    expect(out.updated).toContain("bar : Set");
    expect(out.updated).toContain("foobar : Set");
    expect(out.updated).toContain("bar = foobar");
    expect(out.replacements).toBe(2);
  });
});

describe("matchesTypePattern", () => {
  test("supports underscore wildcards", () => {
    expect(matchesTypePattern("m ≤ m + n", "_ ≤ _ + _")).toBe(true);
    expect(matchesTypePattern("A -> B -> C", "_ -> _")).toBe(true);
  });
});

describe("parse options helpers", () => {
  test("extracts OPTIONS pragmas", () => {
    const source = "{-# OPTIONS --safe --without-K #-}\nmodule A where\n";
    expect(parseOptionsPragmas(source)).toEqual(["--safe", "--without-K"]);
  });

  test("extracts flags from .agda-lib content", () => {
    const lib = "name: x\nflags: --safe --without-K\n";
    expect(parseAgdaLibFlags(lib)).toEqual(["--safe", "--without-K"]);
  });
});

describe("parseModuleSourceShape", () => {
  test("extracts module name and imports", () => {
    const source = "module Foo.Bar where\nopen import Data.Nat\nimport Data.Bool\n";
    const shape = parseModuleSourceShape(source);
    expect(shape.moduleName).toBe("Foo.Bar");
    expect(shape.imports).toHaveLength(2);
    expect(shape.imports[0].moduleName).toBe("Data.Nat");
  });
});

describe("parseTopLevelDefinitions", () => {
  test("extracts signatures and equations", () => {
    const source = "x : Set\nx = Set\n";
    const defs = parseTopLevelDefinitions(source);
    expect(defs.some((d) => d.name === "x" && d.typeSignature)).toBe(true);
    expect(defs.some((d) => d.name === "x" && !d.typeSignature)).toBe(true);
  });
});

describe("extractPostulateSites", () => {
  test("extracts block and inline postulates", () => {
    const source = "postulate ax : Set\npostulate\n  p : Set\n  q : Set\n";
    const sites = extractPostulateSites(source);
    expect(sites).toHaveLength(2);
    expect(sites[0].declarations).toEqual(["ax"]);
    expect(sites[1].declarations).toEqual(["p", "q"]);
  });
});

describe("missing clause inference", () => {
  test("infers arity from an existing clause", () => {
    const source = "f : Nat -> Nat -> Nat\nf x y = x\n";
    expect(inferMissingClauseArity(source, "f")).toBe(2);
    expect(buildMissingClause("f", 2)).toBe("f _ _ = ?");
  });

  test("falls back to one wildcard when nothing is known", () => {
    const source = "module X where\n";
    expect(inferMissingClauseArity(source, "f")).toBe(1);
  });
});

describe("inferFixityConflicts", () => {
  test("detects conflict for user operator without fixity", () => {
    const source = "_≤ℕ_ : Nat -> Nat -> Set\nm ≤ℕ m + n = Set\n";
    const conflicts = inferFixityConflicts(source, { "_+_": 6 });
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].operator).toBe("_≤ℕ_");
  });
});

describe("buildAutoSearchPayload", () => {
  test("renders configurable payload", () => {
    const payload = buildAutoSearchPayload({
      depth: 5,
      listCandidates: true,
      hints: ["helper"],
      excludeHints: ["bad"],
    });
    expect(payload).toContain("-d 5");
    expect(payload).toContain("--list-candidates");
    expect(payload).toContain("-h helper");
    expect(payload).toContain("-x bad");
  });
});


describe("extractPostulateSites — multi-name and comment-skip", () => {
  test("splits multi-name inline declaration: postulate p q r : Set", () => {
    const source = "postulate p q r : Set\n";
    const sites = extractPostulateSites(source);
    expect(sites).toHaveLength(1);
    expect(sites[0].declarations).toEqual(["p", "q", "r"]);
  });

  test("splits multi-name block declaration: a b : Set", () => {
    const source = "postulate\n  a b : Set\n  c : Set → Set\n";
    const sites = extractPostulateSites(source);
    expect(sites).toHaveLength(1);
    expect(sites[0].declarations).toEqual(["a", "b", "c"]);
  });

  test("skips comment-only lines inside a block", () => {
    const source = "postulate\n  -- just a comment\n  real : Set\n";
    const sites = extractPostulateSites(source);
    expect(sites).toHaveLength(1);
    expect(sites[0].declarations).toEqual(["real"]);
    expect(sites[0].declarations).not.toContain("just");
    expect(sites[0].declarations).not.toContain("a");
    expect(sites[0].declarations).not.toContain("comment");
  });

  test("inline single name still works after the fix", () => {
    const source = "postulate myAxiom : Set\n";
    const sites = extractPostulateSites(source);
    expect(sites).toHaveLength(1);
    expect(sites[0].declarations).toEqual(["myAxiom"]);
  });

  test("block with blank lines between declarations", () => {
    const source = "postulate\n  first : Set\n\n  second : Set\n";
    const sites = extractPostulateSites(source);
    expect(sites).toHaveLength(1);
    expect(sites[0].declarations).toEqual(["first", "second"]);
  });
});
