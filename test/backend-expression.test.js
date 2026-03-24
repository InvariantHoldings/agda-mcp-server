import test from "node:test";
import assert from "node:assert/strict";

import { parseBackendExpression } from "../dist/agda/backend-expression.js";

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
