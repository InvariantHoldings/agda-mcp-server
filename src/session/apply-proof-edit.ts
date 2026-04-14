// MIT License — see LICENSE
//
// Apply proof-action results to an Agda source file.
//
// After a successful Cmd_give, Cmd_refine, Cmd_auto, or Cmd_make_case,
// Agda returns the result expression but does NOT modify the file —
// editors are expected to apply the edit themselves. This module does
// that for MCP clients that have no editor buffer.

import { open, writeFile, rename, unlink } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { randomUUID } from "node:crypto";
import { findGoalPosition, findGoalPositions } from "./goal-positions.js";

/**
 * Upper bound on the UTF-8 byte size of any Agda source file we'll
 * read or write. 512 KiB is ~5× larger than the biggest real-world
 * Agda source files the project has seen, so it's a soft cap against
 * pathological inputs rather than a limit that will bite normal
 * code. A stdlib module or a generated file that exceeds this is
 * almost certainly something the agent should NOT be editing
 * through this tool in the first place.
 *
 * The cap protects three things:
 * - Memory: `applyTextEdit` builds the full new source in memory,
 *   so a 500 MB "file" would OOM the server.
 * - Scanner cost: `findGoalPositions` is O(n) on source length and
 *   is called on every proof edit; a multi-MB file noticeably
 *   slows the happy path.
 * - Blast radius: if something has already gone wrong (agent loop,
 *   runaway codegen) and the file has grown unbounded, refusing
 *   the edit surfaces the problem instead of compounding it.
 */
export const MAX_AGDA_SOURCE_BYTES = 512 * 1024;

/**
 * Structured error class for the read-guard failures that show up
 * as `{applied: false, message}` at the tool layer. Using a named
 * class lets callers (and tests) distinguish guard rejections from
 * real I/O errors cleanly.
 */
class AgdaSourceReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgdaSourceReadError";
  }
}

/**
 * Read an Agda source file with two extra safety checks beyond
 * plain `readFile`:
 *
 * 1. **O_NOFOLLOW on the open.** `readFile(path, "utf-8")` follows
 *    symlinks transparently. If a process raced us and replaced
 *    the canonical (post-realpath) target with a symlink between
 *    `resolveExistingPathWithinRoot` and our read, we'd silently
 *    read whatever the symlink points at — potentially outside the
 *    sandbox. `O_NOFOLLOW` makes the open fail with ELOOP in that
 *    case, closing the TOCTOU window. POSIX only; on Windows the
 *    flag is ignored, but Windows requires admin to create
 *    symlinks so the practical attack surface is tiny.
 *
 * 2. **Size cap before reading content.** `fstat` on the open fd
 *    tells us the size without reading a single byte. If the file
 *    exceeds `MAX_AGDA_SOURCE_BYTES` we bail with a structured
 *    error — no unbounded allocation, no scanner work, no
 *    surprises.
 *
 * File descriptor is always closed in the finally block.
 */
async function readAgdaSourceFile(filePath: string): Promise<string> {
  // `O_NOFOLLOW` is a POSIX symbol; on Windows it's 0 (no-op),
  // which is the correct fallback — Windows symlinks need admin
  // to create and are not in our threat model anyway.
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(filePath, flags);
  try {
    const stats = await handle.stat();
    if (stats.size > MAX_AGDA_SOURCE_BYTES) {
      throw new AgdaSourceReadError(
        `File too large: ${stats.size} bytes exceeds the ` +
        `${MAX_AGDA_SOURCE_BYTES}-byte Agda-source cap. ` +
        `This tool does not edit generated or vendored files.`,
      );
    }
    return await handle.readFile("utf-8");
  } finally {
    await handle.close();
  }
}

/**
 * Shared entry point for the three edit functions that need to
 * load source content. Wraps `readAgdaSourceFile` in try/catch and
 * returns a discriminated result so callers never deal with raw
 * exceptions.
 */
async function loadSourceForEdit(
  filePath: string,
): Promise<
  | { ok: true; source: string }
  | { ok: false; code: string; message: string }
> {
  try {
    const source = await readAgdaSourceFile(filePath);
    return { ok: true, source };
  } catch (err) {
    if (err instanceof AgdaSourceReadError) {
      return { ok: false, code: "EFBIG", message: err.message };
    }
    const code = (err as NodeJS.ErrnoException).code ?? "EIO";
    const msg = err instanceof Error ? err.message : String(err);
    // ELOOP = O_NOFOLLOW refused a symlink. Annotate the message
    // so callers can recognize the security-relevant failure mode.
    const prefix = code === "ELOOP" ? "Refusing to follow symlink: " : "";
    return { ok: false, code, message: `${prefix}${msg}` };
  }
}

/**
 * Write `content` to `filePath` atomically via temp-file-rename.
 *
 * `fs.writeFile` truncates and rewrites the target in place: a
 * reader that opens the file mid-write can see a truncated or
 * partially-written state. We instead write to a sibling temp file
 * and `rename()` it over the target, which is atomic on POSIX and
 * NTFS when both paths are on the same filesystem.
 *
 * Security properties:
 * - The temp path mixes pid with `randomUUID()` so two overlapping
 *   calls — e.g. two tool invocations landing in the same
 *   millisecond on the same file — can't produce the same temp
 *   name. The UUID adds 122 bits of entropy so there is no
 *   practical risk of predicting the path.
 * - The temp file is created with `flag: "wx"` (O_CREAT | O_EXCL),
 *   which fails if anything already exists at that path. Even if
 *   an attacker could somehow predict the UUID and pre-plant a
 *   symlink there, the open would fail rather than following the
 *   symlink to an arbitrary target. (Concrete threat model: a
 *   co-located process racing to plant a symlink before we create
 *   the tmp file. Unlikely with 122 bits of entropy, but the
 *   check is free.)
 * - `rename()` on POSIX does NOT follow destination symlinks; if
 *   the target happens to be a symlink at rename time, it is
 *   replaced in place, not followed. So the atomic swap stays
 *   inside whatever directory `filePath` names.
 *
 * On failure we attempt to unlink the temp file so we don't leak
 * `.agda-mcp-tmp-*` turds next to user sources. Unlink errors are
 * swallowed because the primary write error is more interesting.
 */
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  // Same-directory temp file so rename() stays on one filesystem.
  const tmpPath = `${filePath}.agda-mcp-tmp-${process.pid}-${randomUUID()}`;
  try {
    // flag: "wx" → O_CREAT | O_EXCL, refuses to open if the path
    // already exists (e.g. a racing attacker planted a symlink).
    await writeFile(tmpPath, content, { encoding: "utf-8", flag: "wx" });
    await rename(tmpPath, filePath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore cleanup failure — the real error is more informative.
    }
    throw err;
  }
}

// ── Edit types ───────────────────────────────────────────────────────

export interface ReplaceHoleEdit {
  kind: "replace-hole";
  /** The goal ID whose hole marker is being replaced. */
  goalId: number;
  /** The expression to substitute for the hole. */
  expr: string;
}

export interface ReplaceLineEdit {
  kind: "replace-line";
  /** The goal ID on the line being replaced. */
  goalId: number;
  /** The new clause lines that replace the original line. */
  clauses: string[];
}

export type ProofEdit = ReplaceHoleEdit | ReplaceLineEdit;

// ── Result ───────────────────────────────────────────────────────────

export interface ApplyEditResult {
  /** Whether the edit was successfully applied. */
  applied: boolean;
  /** The file path that was modified (or would have been). */
  filePath: string;
  /** Human-readable description of what happened. */
  message: string;
}

// ── Batch result ─────────────────────────────────────────────────────

export interface BatchApplyResult {
  appliedCount: number;
  failedGoalIds: number[];
  /** Goal IDs that appeared more than once in `replacements` — later
   *  occurrences are kept and earlier ones discarded. See the
   *  applyBatchHoleReplacements docstring for rationale. */
  droppedDuplicateGoalIds: number[];
  message: string;
}

/**
 * Apply multiple hole replacements to an Agda source file in one pass.
 *
 * Replacements are applied back-to-front (reverse offset order) so that
 * earlier offsets remain valid after each substitution.
 *
 * Duplicate `goalId`s in `replacements` are handled with a "last wins"
 * rule: the most recently supplied replacement for a given goalId is
 * the one applied, earlier ones are discarded. Agda's SolveAll/SolveOne
 * never emits duplicates, so this branch is defensive — but "last
 * wins" matches the intuition that successive calls should override,
 * and we track the discard count in `droppedDuplicateGoalIds` so
 * agents can notice when their caller-side bug is silently eating
 * work.
 *
 * Returns applied count, goal IDs that couldn't be located, dropped
 * duplicate goal IDs, and a human-readable summary.
 */
export async function applyBatchHoleReplacements(
  filePath: string,
  goalIds: number[],
  replacements: Array<{ goalId: number; expr: string }>,
): Promise<BatchApplyResult> {
  const loadResult = await loadSourceForEdit(filePath);
  if (!loadResult.ok) {
    return {
      appliedCount: 0,
      failedGoalIds: [],
      droppedDuplicateGoalIds: [],
      message: `Could not read file (${loadResult.code}): ${loadResult.message}`,
    };
  }
  const source = loadResult.source;
  const allPositions = findGoalPositions(source);

  // Build goalId → positional index map once (O(n)), so the loop
  // below is O(m) instead of O(n*m).
  const goalIdToIndex = new Map<number, number>();
  for (let i = 0; i < goalIds.length; i++) {
    goalIdToIndex.set(goalIds[i], i);
  }

  // Last-wins deduplication: walk replacements in order and record
  // the final expression for each goalId. Earlier duplicates go into
  // droppedDuplicateGoalIds so we can surface them in the message.
  const lastByGoalId = new Map<number, string>();
  const droppedDuplicateGoalIds: number[] = [];
  for (const { goalId, expr } of replacements) {
    if (lastByGoalId.has(goalId)) {
      droppedDuplicateGoalIds.push(goalId);
    }
    lastByGoalId.set(goalId, expr);
  }

  const edits: Array<{ start: number; end: number; expr: string; goalId: number }> = [];
  const failedGoalIds: number[] = [];

  for (const [goalId, expr] of lastByGoalId) {
    const index = goalIdToIndex.get(goalId);
    if (index === undefined || index >= allPositions.length) {
      failedGoalIds.push(goalId);
      continue;
    }
    const pos = allPositions[index];
    edits.push({ start: pos.startOffset, end: pos.endOffset, expr, goalId });
  }

  const dupMsg =
    droppedDuplicateGoalIds.length > 0
      ? ` (dropped ${droppedDuplicateGoalIds.length} duplicate goalId entr${droppedDuplicateGoalIds.length === 1 ? "y" : "ies"}; last-wins)`
      : "";

  if (edits.length === 0) {
    return {
      appliedCount: 0,
      failedGoalIds,
      droppedDuplicateGoalIds,
      message:
        failedGoalIds.length > 0
          ? `Could not locate goals ${failedGoalIds.map((id) => `?${id}`).join(", ")} in file — the file may have been modified since last load.${dupMsg}`
          : `No replacements to apply.${dupMsg}`,
    };
  }

  // Apply in reverse offset order: modifying later positions first keeps
  // earlier offsets valid for subsequent replacements.
  edits.sort((a, b) => b.start - a.start);

  let newSource = source;
  for (const edit of edits) {
    newSource = newSource.slice(0, edit.start) + edit.expr + newSource.slice(edit.end);
  }

  // Same post-edit cap as applyTextEdit / applyProofEdit: many
  // large solutions could inflate the file past the cap even if
  // individual ones are innocuous.
  if (Buffer.byteLength(newSource, "utf-8") > MAX_AGDA_SOURCE_BYTES) {
    return {
      appliedCount: 0,
      failedGoalIds,
      droppedDuplicateGoalIds,
      message:
        `Batch edit result exceeds the ${MAX_AGDA_SOURCE_BYTES}-byte ` +
        `Agda-source cap; refusing to write. Shrink the solutions or ` +
        `apply them one at a time.${dupMsg}`,
    };
  }

  await writeFileAtomic(filePath, newSource);

  const failedMsg =
    failedGoalIds.length > 0
      ? ` (could not locate ${failedGoalIds.map((id) => `?${id}`).join(", ")})`
      : "";
  return {
    appliedCount: edits.length,
    failedGoalIds,
    droppedDuplicateGoalIds,
    message: `Applied ${edits.length} solution(s) to file${failedMsg}${dupMsg}.`,
  };
}

// ── Free-form text edit ─────────────────────────────────────────────

export interface TextEditResult {
  /** Whether the edit was applied to the file. */
  applied: boolean;
  /** Number of occurrences of `oldText` found in the source. */
  occurrences: number;
  /** 1-based line number where the edit was applied, if any. */
  line: number | null;
  /** Human-readable description. */
  message: string;
}

/**
 * Apply a targeted text substitution to a file on disk.
 *
 * Used by the `agda_apply_edit` tool for edits that aren't goal
 * actions — e.g. adding an import, renaming a symbol, fixing a
 * typo. The caller is expected to reload the file afterwards to
 * resync the Agda session with the new on-disk state.
 *
 * Contract:
 * - By default, `oldText` must match exactly once (fails if 0 or >1).
 * - Pass `occurrence: n` (1-based) to target a specific match when
 *   there are duplicates.
 * - Line-ending normalization: LLMs generate `oldText` / `newText`
 *   with `\n` line endings even when the file uses CRLF. Before
 *   searching we check whether the file contains ANY `\r\n`
 *   sequence (a simple `source.includes("\r\n")` test, not a true
 *   LF-vs-CRLF majority vote); if so, bare `\n` in both `oldText`
 *   and `newText` is promoted to `\r\n` (existing `\r\n` sequences
 *   pass through untouched, so a caller that already matches the
 *   file's style still works). This is deliberately coarse: a
 *   mixed-ending file will be treated as CRLF, because the only
 *   alternative is to introduce fresh bare-LFs into a file that
 *   mostly uses CRLF, which agents rarely want.
 * - The file is written via `writeFileAtomic` (temp file + rename),
 *   so concurrent readers never observe a truncated or half-written
 *   state. The rename is atomic on POSIX and NTFS when both paths
 *   are on the same filesystem, which is always true here because
 *   the temp path is a sibling of the target.
 * - The file is NOT reloaded here — that's the caller's job.
 */
export async function applyTextEdit(
  filePath: string,
  oldText: string,
  newText: string,
  options: { occurrence?: number } = {},
): Promise<TextEditResult> {
  if (oldText.length === 0) {
    return {
      applied: false,
      occurrences: 0,
      line: null,
      message: "oldText must not be empty.",
    };
  }

  // Agda source files are UTF-8 text; a NUL byte in either the
  // anchor or the replacement almost certainly means the caller
  // is either confused or trying to smuggle binary content into
  // what should be plain source. Reject rather than write — a NUL
  // inside a legit Agda file would break most editors, diff tools,
  // and Agda's own lexer at the first byte. Cheap sanity check.
  if (oldText.includes("\u0000") || newText.includes("\u0000")) {
    return {
      applied: false,
      occurrences: 0,
      line: null,
      message: "oldText and newText must not contain NUL bytes.",
    };
  }

  // Load via the hardened reader: O_NOFOLLOW refuses symlink
  // substitution races, the 512 KiB cap catches pathological or
  // vendored files, and all I/O errors (ENOENT, EISDIR, EACCES,
  // ELOOP, EFBIG) come back as a structured failure instead of a
  // thrown exception.
  const loadResult = await loadSourceForEdit(filePath);
  if (!loadResult.ok) {
    return {
      applied: false,
      occurrences: 0,
      line: null,
      message: `Could not read file (${loadResult.code}): ${loadResult.message}`,
    };
  }
  const source = loadResult.source;

  // Normalize oldText/newText to the file's EOL style. "Style" here
  // is simply "does the file contain any \r\n at all?" — if so we
  // treat the whole file as CRLF and promote bare \n in the
  // caller-provided strings to \r\n. This is coarse but matches the
  // contract in the docstring above, and makes LF-authored agent
  // inputs line up with CRLF files without introducing fresh bare
  // LFs into a mostly-CRLF file.
  const fileUsesCrlf = source.includes("\r\n");
  const normalizeEol = (s: string): string =>
    fileUsesCrlf ? s.replace(/(?<!\r)\n/g, "\r\n") : s;
  const searchText = normalizeEol(oldText);
  const replacementText = normalizeEol(newText);

  // Count occurrences
  const occurrences: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = source.indexOf(searchText, searchFrom);
    if (idx === -1) break;
    occurrences.push(idx);
    searchFrom = idx + searchText.length;
  }

  if (occurrences.length === 0) {
    return {
      applied: false,
      occurrences: 0,
      line: null,
      message: `oldText not found in file.`,
    };
  }

  const { occurrence } = options;
  let targetIndex: number;

  if (occurrence !== undefined) {
    if (occurrence < 1 || occurrence > occurrences.length) {
      return {
        applied: false,
        occurrences: occurrences.length,
        line: null,
        message: `Occurrence ${occurrence} requested but only ${occurrences.length} match(es) exist.`,
      };
    }
    targetIndex = occurrences[occurrence - 1];
  } else {
    if (occurrences.length > 1) {
      return {
        applied: false,
        occurrences: occurrences.length,
        line: null,
        message: `oldText matches ${occurrences.length} locations; pass \`occurrence\` (1..${occurrences.length}) to disambiguate.`,
      };
    }
    targetIndex = occurrences[0];
  }

  const newSource =
    source.slice(0, targetIndex) + replacementText + source.slice(targetIndex + searchText.length);

  // Re-check the size cap AFTER applying the edit. The source was
  // already under the cap when we read it, but a huge newText
  // could inflate it past the cap on this one edit. Refusing here
  // keeps the cap meaningful on the write side too.
  if (Buffer.byteLength(newSource, "utf-8") > MAX_AGDA_SOURCE_BYTES) {
    return {
      applied: false,
      occurrences: occurrences.length,
      line: null,
      message:
        `Edit result exceeds the ${MAX_AGDA_SOURCE_BYTES}-byte ` +
        `Agda-source cap; refusing to write. Shrink newText or ` +
        `split the edit across multiple calls.`,
    };
  }

  await writeFileAtomic(filePath, newSource);

  // Compute 1-based line number of the edit start
  let line = 1;
  for (let i = 0; i < targetIndex; i++) {
    if (source[i] === "\n") line++;
  }

  return {
    applied: true,
    occurrences: occurrences.length,
    line,
    message: `Applied edit at line ${line}${occurrences.length > 1 ? ` (occurrence ${occurrence})` : ""}.`,
  };
}

// ── Apply logic ──────────────────────────────────────────────────────

/**
 * Apply a proof-action edit to an Agda source file on disk.
 *
 * For ReplaceHole: replaces the {! !} or ? marker with the expression.
 * For ReplaceLine: replaces the entire line containing the goal with
 * the new clause lines (used for case split). If the hole spans
 * multiple lines (e.g. `{! multi\n line !}`), the edit wipes
 * everything from the start of the opening line to the end of the
 * closing line. This is acceptable for Agda's Cmd_make_case because
 * that command is only invoked on single-line function clauses in
 * practice — we pin the behavior in tests rather than assert on the
 * single-line shape.
 *
 * Returns a result indicating whether the edit was applied.
 */
export async function applyProofEdit(
  filePath: string,
  goalIds: number[],
  edit: ProofEdit,
): Promise<ApplyEditResult> {
  const loadResult = await loadSourceForEdit(filePath);
  if (!loadResult.ok) {
    return {
      applied: false,
      filePath,
      message: `Could not read file (${loadResult.code}): ${loadResult.message}`,
    };
  }
  const source = loadResult.source;

  const pos = findGoalPosition(source, edit.goalId, goalIds);
  if (!pos) {
    return {
      applied: false,
      filePath,
      message: `Could not locate goal ?${edit.goalId} in file — the file may have been modified since last load.`,
    };
  }

  let newSource: string;

  switch (edit.kind) {
    case "replace-hole": {
      // Replace the hole marker with the expression
      newSource =
        source.slice(0, pos.startOffset) +
        edit.expr +
        source.slice(pos.endOffset);
      break;
    }

    case "replace-line": {
      // Detect the file's newline style for consistent line endings
      const eol = source.includes("\r\n") ? "\r\n" : "\n";

      // Find the full line(s) containing the goal marker.
      // For case split, we replace the entire clause line.
      const lineStart = source.lastIndexOf("\n", pos.startOffset) + 1;
      let lineEnd = source.indexOf("\n", pos.endOffset);
      if (lineEnd === -1) lineEnd = source.length;
      // Include the \r before \n if present (CRLF)
      if (lineEnd > 0 && source[lineEnd - 1] === "\r") lineEnd--;

      // Detect indentation of the original line
      const originalLine = source.slice(lineStart, lineEnd);
      const indentMatch = originalLine.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : "";

      // Indent each new clause to match the original
      const indentedClauses = edit.clauses.map((clause) => {
        // If the clause already has indentation, use it as-is;
        // otherwise prepend the detected indent.
        if (clause.startsWith(" ") || clause.startsWith("\t")) {
          return clause;
        }
        return indent + clause;
      });

      newSource =
        source.slice(0, lineStart) +
        indentedClauses.join(eol) +
        source.slice(lineEnd);
      break;
    }
  }

  // Same post-edit cap as applyTextEdit: a huge expression or
  // huge clause array could inflate the file past the cap.
  if (Buffer.byteLength(newSource, "utf-8") > MAX_AGDA_SOURCE_BYTES) {
    return {
      applied: false,
      filePath,
      message:
        `Edit result exceeds the ${MAX_AGDA_SOURCE_BYTES}-byte ` +
        `Agda-source cap; refusing to write.`,
    };
  }

  await writeFileAtomic(filePath, newSource);

  return {
    applied: true,
    filePath,
    message:
      edit.kind === "replace-hole"
        ? `Replaced goal ?${edit.goalId} with \`${edit.expr}\` in file.`
        : `Replaced clause at goal ?${edit.goalId} with ${edit.clauses.length} new clause(s) in file.`,
  };
}
