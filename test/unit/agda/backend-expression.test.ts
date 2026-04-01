import { test, expect } from "vitest";

import { parseBackendExpression } from "../../../src/agda/backend-expression.js";

test("parseBackendExpression accepts simple backend constructors", () => {
	const parsed = parseBackendExpression("GHC");
	expect(parsed.expression).toBe("GHC");
	expect(parsed.displayName).toBe("GHC");
});

test("parseBackendExpression accepts OtherBackend with quoted name", () => {
	const parsed = parseBackendExpression('OtherBackend "JS"');
	expect(parsed.expression).toBe('OtherBackend "JS"');
	expect(parsed.displayName).toBe("OtherBackend JS");
});

test("parseBackendExpression rejects malformed values", () => {
	expect(() => parseBackendExpression("")).toThrow(/cannot be empty/i);
	expect(() => parseBackendExpression("OtherBackend JS")).toThrow(/invalid backend expression/i);
	expect(() => parseBackendExpression("GHC\nX")).toThrow(/single line/i);
});

test("parseBackendExpression rejects whitespace-only input", () => {
	expect(() => parseBackendExpression("   ")).toThrow(/cannot be empty/i);
});

test("parseBackendExpression rejects carriage return", () => {
	expect(() => parseBackendExpression("GHC\rX")).toThrow(/single line/i);
});

test("parseBackendExpression accepts OtherBackend with escaped quotes", () => {
	const parsed = parseBackendExpression('OtherBackend "JS\\"internal\\""');
	expect(parsed.expression).toBe('OtherBackend "JS\\"internal\\""');
	expect(parsed.displayName.includes("JS")).toBeTruthy();
});

test("parseBackendExpression accepts underscore and digits in constructors", () => {
	const parsed = parseBackendExpression("GHC_v2");
	expect(parsed.expression).toBe("GHC_v2");
	expect(parsed.displayName).toBe("GHC_v2");
});

test("parseBackendExpression strips leading/trailing whitespace", () => {
	const parsed = parseBackendExpression("  GHC  ");
	expect(parsed.expression).toBe("GHC");
});
