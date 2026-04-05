import { test, expect } from "vitest";

import {
  boolLiteral,
  command,
  goalCommand,
  modeGoalCommand,
  modeTopLevelCommand,
  profileOptionsList,
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

test("profileOptionsList renders empty list for no profile args", () => {
  expect(profileOptionsList([])).toBe("[]");
});

test("profileOptionsList renders single profile arg", () => {
  expect(profileOptionsList(["--profile=modules"])).toBe('["--profile=modules"]');
});

test("profileOptionsList renders multiple profile args", () => {
  expect(profileOptionsList(["--profile=modules", "--profile=sharing"])).toBe(
    '["--profile=modules", "--profile=sharing"]',
  );
});

test("Cmd_load with profile options produces correct IOTCM payload", () => {
  const opts = profileOptionsList(["--profile=internal", "--profile=metas"]);
  const cmd = command("Cmd_load", quoted("/path/to/file.agda"), opts);
  expect(cmd).toBe(
    'Cmd_load "/path/to/file.agda" ["--profile=internal", "--profile=metas"]',
  );
});

test("Cmd_load without profile options uses empty list", () => {
  const cmd = command("Cmd_load", quoted("/path/to/file.agda"), "[]");
  expect(cmd).toBe('Cmd_load "/path/to/file.agda" []');
});
