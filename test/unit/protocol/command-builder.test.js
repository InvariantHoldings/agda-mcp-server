import test from "node:test";
import assert from "node:assert/strict";

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
} from "../../../dist/protocol/command-builder.js";

test("quoted escapes raw newlines and quotes", () => {
  const rendered = quoted('a"\n b');
  assert.equal(rendered[0], '"');
  assert.equal(rendered.at(-1), '"');
  assert.ok(!rendered.includes("\n"));
  assert.ok(rendered.includes('\\"'));
});

test("goal and mode builders preserve noRange placement", () => {
  assert.equal(goalCommand("Cmd_autoOne", 3, quoted("")), 'Cmd_autoOne 3 noRange ""');
  assert.equal(
    rewriteGoalCommand("Cmd_autoOne", "Normalised", 3, quoted("")),
    'Cmd_autoOne Normalised 3 noRange ""',
  );
  assert.equal(
    modeGoalCommand("Cmd_infer", "Normalised", 4, quoted("x")),
    'Cmd_infer Normalised 4 noRange "x"',
  );
  assert.equal(
    modeTopLevelCommand("Cmd_infer_toplevel", "Normalised", quoted("x")),
    'Cmd_infer_toplevel Normalised "x"',
  );
  assert.equal(
    rewriteTopLevelCommand("Cmd_metas", "Normalised"),
    "Cmd_metas Normalised",
  );
});

test("stringList and boolLiteral render stable protocol atoms", () => {
  assert.equal(stringList([]), "[]");
  assert.equal(stringList(["a", 'b"c']), '["a", "b\\"c"]');
  assert.equal(boolLiteral(true), "True");
  assert.equal(boolLiteral(false), "False");
  assert.equal(command("Cmd_show_version"), "Cmd_show_version");
});
