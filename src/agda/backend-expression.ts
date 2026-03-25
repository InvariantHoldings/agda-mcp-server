// MIT License — see LICENSE
//
// Validation for Agda backend expression syntax used in IOTCM commands.

const SIMPLE_BACKEND_EXPR = /^[A-Za-z][A-Za-z0-9_]*$/;
const OTHER_BACKEND_EXPR = /^OtherBackend\s+"(?:[^"\\]|\\.)+"$/;

export interface ParsedBackendExpression {
  expression: string;
  displayName: string;
}

export function parseBackendExpression(input: string): ParsedBackendExpression {
  const expression = input.trim();

  if (!expression) {
    throw new Error("Backend expression cannot be empty.");
  }

  if (/[\r\n]/.test(expression)) {
    throw new Error("Backend expression must be a single line.");
  }

  if (SIMPLE_BACKEND_EXPR.test(expression)) {
    return {
      expression,
      displayName: expression,
    };
  }

  if (OTHER_BACKEND_EXPR.test(expression)) {
    // Extract name between outer quotes, then unescape internal sequences
    const quoted = expression.slice(expression.indexOf('"'));
    const name = quoted.slice(1, -1).replace(/\\(.)/g, "$1");
    return {
      expression,
      displayName: `OtherBackend ${name}`,
    };
  }

  throw new Error(
    "Invalid backend expression. Use a constructor name like GHC/LaTeX/QuickLaTeX or OtherBackend \"Name\".",
  );
}
