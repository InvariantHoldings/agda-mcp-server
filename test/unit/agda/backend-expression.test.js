import test from "node:test";
import assert from "node:assert/strict";

import { parseBackendExpression } from "../../../dist/agda/backend-expression.js";

test("parseBackendExpression accepts simple backend constructors", () => {
	const parsed = parseBackendExpression("GHC");
	assert.equal(parsed.expression, "GHC");
	assert.equal(parsed.displayName, "GHC");
});

test("parseBackendExpression accepts OtherBackend with quoted name", () => {
	const parsed = parseBackendExpression('OtherBackend "JS"');
	assert.equal(parsed.expression, 'OtherBackend "JS"');
	assert.equal(parsed.displayName, "OtherBackend JS");
});

test("parseBackendExpression rejects malformed values", () => {
	assert.throws(() => parseBackendExpression(""), /cannot be empty/i);
	assert.throws(() => parseBackendExpression("OtherBackend JS"), /invalid backend expression/i);
	assert.throws(() => parseBackendExpression("GHC\nX"), /single line/i);
});

test("parseBackendExpression rejects whitespace-only input", () => {
	assert.throws(() => parseBackendExpression("   "), /cannot be empty/i);
});

test("parseBackendExpression rejects carriage return", () => {
	assert.throws(() => parseBackendExpression("GHC\rX"), /single line/i);
});

test("parseBackendExpression accepts OtherBackend with escaped quotes", () => {
	const parsed = parseBackendExpression('OtherBackend "JS\\"internal\\""');
	assert.equal(parsed.expression, 'OtherBackend "JS\\"internal\\""');
	assert.ok(parsed.displayName.includes("JS"));
});

test("parseBackendExpression accepts underscore and digits in constructors", () => {
	const parsed = parseBackendExpression("GHC_v2");
	assert.equal(parsed.expression, "GHC_v2");
	assert.equal(parsed.displayName, "GHC_v2");
});

test("parseBackendExpression strips leading/trailing whitespace", () => {
	const parsed = parseBackendExpression("  GHC  ");
	assert.equal(parsed.expression, "GHC");
});
