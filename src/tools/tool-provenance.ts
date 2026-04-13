// MIT License — see LICENSE
//
// Global provenance registry for tool envelopes.
//
// Keys registered here are merged into every tool envelope's `provenance`
// field by okEnvelope / errorEnvelope. Used for process-wide metadata
// (Agda version, server version, toolchain hash) that every response
// should carry so an agent doesn't have to re-ask. Tool-specific
// provenance keys from the call site always override global keys with
// the same name.
//
// SECURITY: the registry and the merge result are both null-prototype
// objects. This prevents a future caller from writing to `__proto__` /
// `constructor` / other special property slots via registerGlobalProvenance
// and affecting lookups on unrelated objects (CWE-1321, "Prototype
// Pollution"). It also means JSON.stringify is the only observer of these
// objects, so there's no accidental inheritance from Object.prototype.

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export type ProvenanceRecord = Record<string, unknown>;

function createProvenanceRecord(): ProvenanceRecord {
  return Object.create(null) as ProvenanceRecord;
}

const globalProvenance: ProvenanceRecord = createProvenanceRecord();

export function registerGlobalProvenance(key: string, value: unknown): void {
  if (typeof key !== "string" || key.length === 0 || UNSAFE_KEYS.has(key)) {
    return;
  }
  if (value === undefined || value === null) {
    delete globalProvenance[key];
    return;
  }
  globalProvenance[key] = value;
}

export function clearGlobalProvenance(): void {
  for (const key of Object.keys(globalProvenance)) {
    delete globalProvenance[key];
  }
}

function copyOwnStringKeys(
  dst: ProvenanceRecord,
  src: ProvenanceRecord | undefined,
): void {
  if (!src) return;
  for (const key of Object.keys(src)) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    dst[key] = src[key];
  }
}

export function mergeProvenance(
  local: ProvenanceRecord | undefined,
): ProvenanceRecord | undefined {
  const globalKeys = Object.keys(globalProvenance);
  const hasLocal = local !== undefined && Object.keys(local).length > 0;
  if (globalKeys.length === 0 && !hasLocal) {
    return undefined;
  }
  const merged = createProvenanceRecord();
  copyOwnStringKeys(merged, globalProvenance);
  copyOwnStringKeys(merged, local);
  return merged;
}
