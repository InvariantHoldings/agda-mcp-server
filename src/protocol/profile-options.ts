// MIT License — see LICENSE
//
// Profile option types and validation for Agda's --profile flag.
//
// Agda supports profiling via `--profile=<option>` which can be passed
// as command-line options in the Cmd_load [String] argument. The profile
// options control what performance data Agda collects during type checking.
//
// Reference: Agda.Interaction.Options.ProfileOptions (Agda source)
// Valid options: internal, modules, definitions, sharing, serialize,
//               constraints, metas, interactive, conversion, instances,
//               sections, all
//
// Mutual exclusivity: internal, modules, and definitions cannot be
// combined with each other.

/**
 * Individual profile option matching Agda's ProfileOption data type.
 */
export const PROFILE_OPTIONS = [
  "internal",
  "modules",
  "definitions",
  "sharing",
  "serialize",
  "constraints",
  "metas",
  "interactive",
  "conversion",
  "instances",
  "sections",
] as const;

export type ProfileOption = (typeof PROFILE_OPTIONS)[number];

/** Special meta-option that enables all compatible options. */
export const PROFILE_ALL = "all";

/** All strings accepted as profile options (including "all"). */
export const VALID_PROFILE_OPTION_STRINGS: readonly string[] = [
  PROFILE_ALL,
  ...PROFILE_OPTIONS,
];

/**
 * Groups of mutually exclusive profile options.
 * Within each group, only one option may be active at a time.
 */
const MUTUALLY_EXCLUSIVE_GROUPS: readonly (readonly ProfileOption[])[] = [
  ["internal", "modules", "definitions"],
];

export interface ProfileValidationResult {
  valid: boolean;
  errors: string[];
  /** The normalized, validated options (with "all" expanded). */
  options: ProfileOption[];
}

function isProfileOption(s: string): s is ProfileOption {
  return (PROFILE_OPTIONS as readonly string[]).includes(s);
}

/**
 * Find incompatible options already present in the set for a candidate.
 */
function findConflicts(
  candidate: ProfileOption,
  existing: readonly ProfileOption[],
): ProfileOption[] {
  const conflicts: ProfileOption[] = [];
  for (const group of MUTUALLY_EXCLUSIVE_GROUPS) {
    if (!group.includes(candidate)) continue;
    for (const opt of existing) {
      if (opt !== candidate && group.includes(opt)) {
        conflicts.push(opt);
      }
    }
  }
  return conflicts;
}

/**
 * Expand "all" into the full set of compatible options.
 *
 * Agda's semantics: "all" adds every option compatible with those
 * already present. So `["modules", "all"]` keeps "modules" and adds
 * everything except "internal" and "definitions".
 */
function expandAll(existing: ProfileOption[]): ProfileOption[] {
  const result = [...existing];
  for (const opt of PROFILE_OPTIONS) {
    if (result.includes(opt)) continue;
    if (findConflicts(opt, result).length === 0) {
      result.push(opt);
    }
  }
  return result;
}

/**
 * Validate and normalize a list of profile option strings.
 *
 * Follows Agda's semantics:
 * - Each string must be a valid profile option or "all"
 * - Mutually exclusive options (internal/modules/definitions) cannot coexist
 * - "all" expands to all compatible options, respecting existing exclusions
 */
export function validateProfileOptions(
  input: readonly string[],
): ProfileValidationResult {
  const errors: string[] = [];
  let options: ProfileOption[] = [];

  for (const raw of input) {
    const s = raw.toLowerCase();

    if (s === PROFILE_ALL) {
      options = expandAll(options);
      continue;
    }

    if (!isProfileOption(s)) {
      errors.push(
        `Not a valid profiling option: '${raw}'. Valid options are ${PROFILE_OPTIONS.join(", ")}, or all.`,
      );
      continue;
    }

    const conflicts = findConflicts(s, options);
    if (conflicts.length > 0) {
      errors.push(
        `Cannot use profiling option '${s}' with '${conflicts[0]}'.`,
      );
      continue;
    }

    if (!options.includes(s)) {
      options.push(s);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    options,
  };
}

/**
 * Convert validated profile options to Agda command-line argument strings.
 */
export function toProfileArgs(options: readonly ProfileOption[]): string[] {
  return options.map((opt) => `--profile=${opt}`);
}
