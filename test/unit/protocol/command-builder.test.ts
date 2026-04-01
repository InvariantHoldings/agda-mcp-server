import { test, expect } from "vitest";

import {
  boolLiteral,
  command,
  goalCommand,
  modeGoalCommand,
  modeTopLevelCommand,
  quoted,
  rewriteGoalCommand,
  rewriteTopLevelCommand,
  stringList,
} from "../../../src/protocol/command-builder.js";

test("quoted escapes raw newlines and quotes", () => {
  const rendered = quoted('a"\n b');
  expect(rendered[0]).toBe('"');
  expect(rendered.at(-1)).toBe('"');
  expect(!rendered.includes("\n")).toBeTruthy();
  expect(rendered.includes('\\"')).toBeTruthy();
});

test("goal and mode builders preserve noRange placement", () => {
  expect(goalCommand("Cmd_autoOne", 3, quoted(""))).toBe('Cmd_autoOne 3 noRange ""');
  expect(
    rewriteGoalCommand("Cmd_autoOne", "Normalised", 3, quoted("")),
  ).toBe('Cmd_autoOne Normalised 3 noRange ""');
  expect(
    modeGoalCommand("Cmd_infer", "Normalised", 4, quoted("x")),
  ).toBe('Cmd_infer Normalised 4 noRange "x"');
  expect(
    modeTopLevelCommand("Cmd_infer_toplevel", "Normalised", quoted("x")),
  ).toBe('Cmd_infer_toplevel Normalised "x"');
  expect(
    rewriteTopLevelCommand("Cmd_metas", "Normalised"),
  ).toBe("Cmd_metas Normalised");
});

test("stringList and boolLiteral render stable protocol atoms", () => {
  expect(stringList([])).toBe("[]");
  expect(stringList(["a", 'b"c'])).toBe('["a", "b\\"c"]');
  expect(boolLiteral(true)).toBe("True");
  expect(boolLiteral(false)).toBe("False");
  expect(command("Cmd_show_version")).toBe("Cmd_show_version");
});
