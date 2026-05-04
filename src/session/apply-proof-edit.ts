// MIT License — see LICENSE
//
// Barrel for the proof-edit applicator family. The 626-line original
// has been split into focused modules:
//
//   - safe-source-io.ts    hardened read/write primitives (O_NOFOLLOW
//                          + size cap on read, atomic temp+rename on
//                          write) and the `MAX_AGDA_SOURCE_BYTES` cap.
//   - apply-goal-edit.ts   `applyProofEdit` for `replace-hole` and
//                          `replace-line` edits keyed by goal ID, plus
//                          the `ProofEdit` / `ApplyEditResult` types.
//   - apply-batch-edits.ts `applyBatchHoleReplacements` for
//                          `agda_solve_all`-style multi-hole writes.
//   - apply-text-edit.ts   `applyTextEdit` for free-form
//                          `oldText`/`newText` substitutions
//                          (`agda_apply_edit`).
//
// External imports of names previously exported from this module keep
// working unchanged — this barrel re-exports the same public surface.

export {
  MAX_AGDA_SOURCE_BYTES,
} from "./safe-source-io.js";

export type {
  ProofEdit,
  ReplaceHoleEdit,
  ReplaceLineEdit,
  ApplyEditResult,
} from "./apply-goal-edit.js";
export { applyProofEdit } from "./apply-goal-edit.js";

export type { BatchApplyResult } from "./apply-batch-edits.js";
export { applyBatchHoleReplacements } from "./apply-batch-edits.js";

export type { TextEditResult } from "./apply-text-edit.js";
export { applyTextEdit } from "./apply-text-edit.js";
