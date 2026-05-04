// MIT License — see LICENSE
//
// Hardened file I/O primitives shared by every proof-edit applicator.
// Three concerns belong here and nowhere else:
//
//   1. Refusing symlink-substitution races on read (O_NOFOLLOW).
//   2. Capping the source size before allocating any reader buffer
//      (`MAX_AGDA_SOURCE_BYTES`).
//   3. Atomic writes via temp-file + rename so concurrent readers
//      never observe a half-written source.
//
// Putting these in one place keeps the apply-* modules focused on the
// edit semantics and lets the safety properties be reasoned about
// (and tested) once.

import { open, writeFile, rename, unlink } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { randomUUID } from "node:crypto";

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
export class AgdaSourceReadError extends Error {
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
export async function readAgdaSourceFile(filePath: string): Promise<string> {
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
export async function loadSourceForEdit(
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
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
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
