// MIT License — see LICENSE
//
// Free-form text-edit applicator (the engine behind `agda_apply_edit`).
// Distinguished from goal edits because the caller addresses the edit
// by `oldText` substring rather than a goal ID — useful for imports,
// renames, and typo fixes that have no associated interaction point.

import {
  MAX_AGDA_SOURCE_BYTES,
  loadSourceForEdit,
  writeFileAtomic,
} from "./safe-source-io.js";

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
