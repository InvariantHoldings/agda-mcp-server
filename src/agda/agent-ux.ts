// MIT License — see LICENSE
//
// Agent-facing static analysis helpers used by the UX-oriented tools.

export type TriageClass =
  | "mechanical-import"
  | "mechanical-rename"
  | "parser-regression"
  | "coverage-missing"
  | "proof-obligation"
  | "dep-failure"
  | "toolchain";

export interface TriageSuggestedAction {
  action: string;
  symbol?: string;
  from?: string;
  to?: string;
  module?: string;
}

export interface TriageResult {
  category: TriageClass;
  confidence: number;
  suggestedAction: TriageSuggestedAction;
  suggestedRename?: string;
}

export interface AutoSearchOptions {
  depth?: number;
  listCandidates?: boolean;
  excludeHints?: string[];
  hints?: string[];
}

export interface ScopedRenameResult {
  updated: string;
  replacements: number;
}

export interface ImportStatement {
  moduleName: string;
  line: number;
  openImport: boolean;
}

export interface ModuleSourceShape {
  moduleName: string | null;
  imports: ImportStatement[];
}

export interface DefinitionSite {
  name: string;
  line: number;
  typeSignature: boolean;
}

export interface PostulateSite {
  line: number;
  declarations: string[];
}

export interface FixityConflict {
  operator: string;
  line: number;
  conflictingOperator: string;
  conflictingPrecedence: number;
  suggestedFixity: string;
}

const DEFAULT_IMPORTED_FIXITIES: Readonly<Record<string, number>> = {
  "_+_": 6,
  "_-_": 6,
  "_*_": 7,
  "_≤_": 4,
  "_<_": 4,
  "_≡_": 4,
  "_∧_": 3,
  "_∨_": 2,
};

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(2));
}

export function rewriteCompilerPlaceholders(message: string): string {
  return message
    .replace(/\.AGDA\b/g, "<ext>")
    .replace(/\.LAGDA(?:\.MD|\.TEX|\.RST|\.ORG)?\b/g, "<ext>");
}

export function extractSuggestedRename(message: string): string | null {
  const normalized = rewriteCompilerPlaceholders(message);

  const quoted = /did you mean\s+[`'"]([^`'"\n]+)[`'"]\??/iu.exec(normalized);
  if (quoted) return quoted[1].trim() || null;

  const bare = /did you mean\s+([^\s,.;:!?()]+)\??/iu.exec(normalized);
  if (bare) return bare[1].trim() || null;

  return null;
}

function parseNotInScopeSymbol(message: string): string | undefined {
  const quoted = /not in scope:\s*[`'"]([^`'"\n]+)[`'"]/iu.exec(message);
  if (quoted) return quoted[1].trim() || undefined;
  const bare = /not in scope:\s*([^\s,.;:!?()]+)/iu.exec(message);
  return bare?.[1]?.trim() || undefined;
}

export function classifyAgdaError(message: string): TriageResult {
  const normalized = rewriteCompilerPlaceholders(message);
  const lower = normalized.toLowerCase();
  const suggestedRename = extractSuggestedRename(normalized) ?? undefined;
  const symbol = parseNotInScopeSymbol(normalized);

  if (
    /command not found|no such file or directory|failed to start|permission denied|cannot execute/iu.test(normalized)
    || lower.includes("agda_dir")
    || lower.includes("library") && lower.includes("not found")
  ) {
    return {
      category: "toolchain",
      confidence: 0.95,
      suggestedAction: { action: "verify-toolchain" },
      suggestedRename,
    };
  }

  if (
    /module .* doesn't export|moduledoesntexport/iu.test(normalized)
    || (suggestedRename !== undefined && /export/iu.test(normalized))
  ) {
    return {
      category: suggestedRename ? "mechanical-rename" : "mechanical-import",
      confidence: suggestedRename ? 0.93 : 0.85,
      suggestedAction: suggestedRename
        ? { action: "apply_rename", to: suggestedRename }
        : { action: "fix_import" },
      suggestedRename,
    };
  }

  if (
    /not in scope|unknown name|unknown identifier/iu.test(normalized)
    || /cannot resolve module/iu.test(normalized)
  ) {
    if (suggestedRename) {
      return {
        category: "mechanical-rename",
        confidence: 0.91,
        suggestedAction: {
          action: "apply_rename",
          symbol,
          to: suggestedRename,
        },
        suggestedRename,
      };
    }
    return {
      category: "mechanical-import",
      confidence: 0.87,
      suggestedAction: { action: "suggest_import", symbol },
      suggestedRename,
    };
  }

  if (/parse error|lexical error|could not parse|failed to parse/iu.test(normalized)) {
    return {
      category: "parser-regression",
      confidence: 0.92,
      suggestedAction: { action: "repair_parser_syntax" },
      suggestedRename,
    };
  }

  if (/coverage|incomplete pattern matching|missing cases|missing clause/iu.test(normalized)) {
    return {
      category: "coverage-missing",
      confidence: 0.89,
      suggestedAction: { action: "add_missing_clauses" },
      suggestedRename,
    };
  }

  if (
    /dependency|import cycle|while scope checking|while checking the declaration of/iu.test(normalized)
    && /in [^ ]+\.agda/iu.test(normalized)
  ) {
    return {
      category: "dep-failure",
      confidence: 0.78,
      suggestedAction: { action: "repair_dependency" },
      suggestedRename,
    };
  }

  return {
    category: "proof-obligation",
    confidence: 0.72,
    suggestedAction: { action: "open_interactive_goal" },
    suggestedRename,
  };
}

export function buildAutoSearchPayload(options: AutoSearchOptions): string {
  const flags: string[] = [];
  if (options.depth !== undefined) {
    flags.push(`-d ${Math.max(0, Math.trunc(options.depth))}`);
  }
  if (options.listCandidates) {
    flags.push("--list-candidates");
  }
  for (const hint of options.hints ?? []) {
    if (hint.trim().length > 0) {
      flags.push(`-h ${hint.trim()}`);
    }
  }
  for (const excluded of options.excludeHints ?? []) {
    if (excluded.trim().length > 0) {
      flags.push(`-x ${excluded.trim()}`);
    }
  }
  return flags.join(" ").trim();
}

export function splitWords(input: string): string[] {
  return input
    .trim()
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function tokenMatches(pattern: string, actual: string): boolean {
  if (pattern === "_") return true;
  return pattern === actual;
}

export function matchesTypePattern(typeText: string, pattern: string): boolean {
  const actualTokens = splitWords(typeText);
  const patternTokens = splitWords(pattern);
  if (patternTokens.length === 0) return false;
  if (actualTokens.length === 0) return false;

  let p = 0;
  let a = 0;
  while (p < patternTokens.length && a < actualTokens.length) {
    const want = patternTokens[p];
    if (want === "_") {
      p += 1;
      a += 1;
      continue;
    }
    if (tokenMatches(want, actualTokens[a])) {
      p += 1;
      a += 1;
      continue;
    }
    a += 1;
  }
  return p === patternTokens.length;
}

function isIdentifierLike(text: string): boolean {
  return /^[\p{L}\p{N}_'.]+$/u.test(text);
}

export function applyScopedRename(source: string, from: string, to: string): ScopedRenameResult {
  if (from.length === 0 || from === to) {
    return { updated: source, replacements: 0 };
  }

  if (isIdentifierLike(from)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_'])(${escaped})(?=$|[^\\p{L}\\p{N}_'])`, "gmu");
    let replacements = 0;
    const updated = source.replace(re, (match, prefix: string, name: string) => {
      void match;
      void name;
      replacements += 1;
      return `${prefix}${to}`;
    });
    return { updated, replacements };
  }

  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "gu");
  let replacements = 0;
  const updated = source.replace(re, () => {
    replacements += 1;
    return to;
  });
  return { updated, replacements };
}

export function parseOptionsPragmas(source: string): string[] {
  const options: string[] = [];
  const re = /\{-#\s*OPTIONS\s+([^#]+)#-\}/gmu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    options.push(...splitWords(m[1]));
  }
  return options;
}

export function parseAgdaLibFlags(source: string): string[] {
  const flags: string[] = [];
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!/^flags\s*:/u.test(line)) continue;
    const match = /^flags\s*:\s*(.*)$/u.exec(line);
    if (!match) continue;
    flags.push(...splitWords(match[1]));
  }
  return flags;
}

export function parseModuleSourceShape(source: string): ModuleSourceShape {
  const moduleMatch = /^\s*module\s+([A-Za-z_][\w.]*)\b/mu.exec(source);
  const imports: ImportStatement[] = [];
  const lines = source.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(open\s+)?import\s+([A-Za-z_][\w.]*)\b/u.exec(lines[i]);
    if (!match) continue;
    imports.push({
      moduleName: match[2],
      line: i + 1,
      openImport: Boolean(match[1]),
    });
  }
  return {
    moduleName: moduleMatch?.[1] ?? null,
    imports,
  };
}

export function parseTopLevelDefinitions(source: string): DefinitionSite[] {
  const defs: DefinitionSite[] = [];
  const lines = source.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sig = /^\s*([^\s].*?)\s*:\s*\S/u.exec(line);
    if (sig) {
      const name = sig[1].trim();
      if (name.length > 0) {
        defs.push({ name, line: i + 1, typeSignature: true });
      }
      continue;
    }
    const eq = /^\s*([^\s].*?)\s*=\s*\S/u.exec(line);
    if (eq) {
      const name = eq[1].trim().split(/\s+/u)[0];
      if (name.length > 0) {
        defs.push({ name, line: i + 1, typeSignature: false });
      }
    }
  }
  return defs;
}

export function extractPostulateSites(source: string): PostulateSite[] {
  const lines = source.split(/\r?\n/u);
  const sites: PostulateSite[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!/^postulate\b/u.test(trimmed) && !/^\s+postulate\b/u.test(lines[i])) {
      continue;
    }

    const inline = /^postulate\s+(.+)$/u.exec(trimmed);
    if (inline) {
      // Split on `:` and tokenise LHS — handles `postulate p q : Set`
      const lhs = inline[1].split(":")[0].trim();
      const names = lhs.split(/\s+/u).filter((t) => t.length > 0 && !t.startsWith("--"));
      sites.push({ line: i + 1, declarations: names });
      continue;
    }

    const indent = lines[i].match(/^(\s*)/u)?.[1].length ?? 0;
    const declarations: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const body = lines[j];
      const bodyTrimmed = body.trim();
      // Skip blank and comment-only lines within the block
      if (bodyTrimmed.length === 0 || bodyTrimmed.startsWith("--")) {
        j += 1;
        continue;
      }
      const bodyIndent = body.match(/^(\s*)/u)?.[1].length ?? 0;
      if (bodyIndent <= indent) break;
      // Split on `:` and tokenise LHS — handles `p q : Set` (multiple names)
      const lhs = bodyTrimmed.split(":")[0].trim();
      const names = lhs.split(/\s+/u).filter((t) => t.length > 0 && !t.startsWith("--"));
      declarations.push(...names);
      j += 1;
    }
    sites.push({ line: i + 1, declarations });
  }

  return sites;
}

export function inferMissingClauseArity(source: string, functionName: string): number {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = source.split(/\r?\n/u);

  const clauseRe = new RegExp(`^\\s*${escaped}\\b([^=]*)=`, "u");
  for (const line of lines) {
    const match = clauseRe.exec(line);
    if (!match) continue;
    const args = splitWords(match[1]).filter((token) => token !== "|");
    return args.length;
  }

  const sigRe = new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, "u");
  for (const line of lines) {
    const match = sigRe.exec(line);
    if (!match) continue;
    const type = match[1];
    const arrows = (type.match(/->|→/gu) ?? []).length;
    return arrows;
  }

  return 1;
}

export function buildMissingClause(functionName: string, arity: number): string {
  if (arity <= 0) return `${functionName} = ?`;
  return `${functionName} ${Array.from({ length: arity }, () => "_").join(" ")} = ?`;
}

function parseDeclaredFixities(source: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const match = /^infix[lr]?\s+(\d+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const precedence = Number.parseInt(match[1], 10);
    for (const symbol of splitWords(match[2])) {
      map.set(symbol, precedence);
    }
  }
  return map;
}

function lineUsesOperator(line: string, operator: string): boolean {
  if (line.includes(operator)) return true;
  if (operator.startsWith("_") && operator.endsWith("_") && operator.length > 2) {
    const surface = operator.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${surface}(\\s|$)`, "u").test(line);
  }
  return false;
}

function parseUserDefinedOperators(source: string): Array<{ operator: string; line: number }> {
  const ops: Array<{ operator: string; line: number }> = [];
  const lines = source.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = /^\s*(_[^\s]+_)\s*[:=]/u.exec(line);
    if (!match) continue;
    ops.push({ operator: match[1], line: i + 1 });
  }
  return ops;
}

export function inferFixityConflicts(
  source: string,
  importedFixities: Readonly<Record<string, number>> = DEFAULT_IMPORTED_FIXITIES,
): FixityConflict[] {
  const declared = parseDeclaredFixities(source);
  const ops = parseUserDefinedOperators(source);
  const lines = source.split(/\r?\n/u);
  const conflicts: FixityConflict[] = [];
  const seen = new Set<string>();

  for (const op of ops) {
    if (declared.has(op.operator)) continue;
    for (const [importedOp, importedPrecedence] of Object.entries(importedFixities)) {
      if (importedOp === op.operator) continue;
      for (let i = 0; i < lines.length; i++) {
        if (!lineUsesOperator(lines[i], op.operator) || !lineUsesOperator(lines[i], importedOp)) continue;
        if (20 <= importedPrecedence) continue;
        const key = `${op.operator}:${i + 1}:${importedOp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          operator: op.operator,
          line: i + 1,
          conflictingOperator: importedOp,
          conflictingPrecedence: importedPrecedence,
          suggestedFixity: `infix ${Math.max(0, importedPrecedence)} ${op.operator}`,
        });
      }
    }
  }

  return conflicts.sort((a, b) => a.line - b.line || a.operator.localeCompare(b.operator));
}

export function normalizeConfidence(value: number): number {
  return clampProbability(value);
}
