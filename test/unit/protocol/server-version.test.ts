import { test, expect, describe } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  agdaMcpServerBlockSchema,
  agdaVersionStringSchema,
  classifyAgdaAgainstSupportedRange,
  describeOutOfRangeWarning,
  getServerVersion,
  getSupportedAgdaRange,
  packageMetadataSchema,
  parsePackageMetadata,
} from "../../../src/server-version.js";
import { parseAgdaVersion } from "../../../src/agda/agda-version.js";

test("runtime server version matches package.json", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8"),
  );

  expect(getServerVersion()).toBe(packageJson.version);
});

test("getSupportedAgdaRange mirrors package.json#agdaMcpServer block", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8"),
  ) as { agdaMcpServer?: { minAgdaVersion?: string; maxTestedAgdaVersion?: string } };

  const range = getSupportedAgdaRange();
  expect(range.minAgdaVersion).toBe(packageJson.agdaMcpServer?.minAgdaVersion);
  expect(range.maxTestedAgdaVersion).toBe(packageJson.agdaMcpServer?.maxTestedAgdaVersion);
});

describe("classifyAgdaAgainstSupportedRange", () => {
  test("returns unknown when no detected version is provided", () => {
    const status = classifyAgdaAgainstSupportedRange(null);
    expect(status.classification).toBe("unknown");
    expect(status.detected).toBeUndefined();
    expect(describeOutOfRangeWarning(status)).toBeUndefined();
  });

  test("classifies a version below min as below-min", () => {
    // Use a version comfortably below the declared minimum. The
    // package.json minimum is 2.6.4.3, so 2.5.0 is unambiguously below.
    const status = classifyAgdaAgainstSupportedRange(parseAgdaVersion("2.5.0"));
    expect(status.classification).toBe("below-min");
    const warning = describeOutOfRangeWarning(status);
    expect(warning).toBeDefined();
    expect(warning).toContain("2.5.0");
    expect(warning).toContain("below the declared minimum");
  });

  test("classifies a version inside the range as in-range", () => {
    const status = classifyAgdaAgainstSupportedRange(parseAgdaVersion("2.7.0.1"));
    expect(status.classification).toBe("in-range");
    expect(describeOutOfRangeWarning(status)).toBeUndefined();
  });

  test("classifies a version above max-tested as above-max", () => {
    // Use a version beyond any reasonable maxTestedAgdaVersion the
    // server might declare. 9.9.9 is sentinel-like enough that this
    // remains true even after the range is bumped in future releases.
    const status = classifyAgdaAgainstSupportedRange(parseAgdaVersion("9.9.9"));
    expect(status.classification).toBe("above-max");
    const warning = describeOutOfRangeWarning(status);
    expect(warning).toBeDefined();
    expect(warning).toContain("newer than the maximum tested");
  });

  test("returned range matches getSupportedAgdaRange", () => {
    const status = classifyAgdaAgainstSupportedRange(parseAgdaVersion("2.7.0.1"));
    expect(status.range).toEqual(getSupportedAgdaRange());
  });

  test("cached SupportedAgdaRange is frozen — accidental mutation throws", () => {
    // Both reporting tools and the startup warning share the cached
    // range object. If a downstream caller could rewrite it, every
    // subsequent call would see the tampered bounds. The freeze guards
    // that.
    const range = getSupportedAgdaRange();
    expect(() => {
      (range as unknown as { minAgdaVersion: string }).minAgdaVersion = "0.0.0";
    }).toThrow(TypeError);
  });

  test("getSupportedAgdaRange returns the same identity on repeat calls", () => {
    // Caching is observable: repeat callers must see the identical
    // reference, not a fresh allocation per call. This documents the
    // hot-path optimisation that backs every tool-callback that calls
    // getServerVersion or getSupportedAgdaRange.
    expect(getSupportedAgdaRange()).toBe(getSupportedAgdaRange());
  });
});

describe("agdaVersionStringSchema", () => {
  test("accepts dotted Agda version strings", () => {
    for (const accepted of ["2.6.4.3", "2.7.0.1", "2.8.0", "2.9.0", "2.9.0-rc1", "10.0.0-pre.1"]) {
      expect(() => agdaVersionStringSchema.parse(accepted)).not.toThrow();
    }
  });

  test("rejects non-version strings the parser would silently ignore", () => {
    // These all parsed as "no minimum / no max" before the regex
    // tightening landed: a typo would silently degrade to "unknown"
    // classification with no maintainer-visible signal. The schema
    // now rejects them at module init.
    for (const rejected of [
      "",
      "latest",
      ".2.9.0",
      "2.9.0.",
      "2..9",
      "2.9.0-",
      "v2.9.0",
      "2.9.0; rm -rf /",
      "2.9.0\n2.10.0",
      "Agda version 2.9.0",
    ]) {
      expect(() => agdaVersionStringSchema.parse(rejected), `${rejected} should be rejected`).toThrow();
    }
  });

  test("packageMetadataSchema rejects non-string version field", () => {
    expect(() => packageMetadataSchema.parse({ version: 123 })).toThrow();
  });

  test("packageMetadataSchema accepts the live package.json shape", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8"),
    );
    expect(() => packageMetadataSchema.parse(packageJson)).not.toThrow();
  });

  test("agdaMcpServerBlockSchema rejects malformed bounds independently of version", () => {
    // PR #52 review #4: a malformed bound used to invalidate the
    // whole package metadata, blanking the server version. The two
    // concerns are now parsed independently — assert the block
    // schema fails on bad bounds without the test having to know
    // anything about the version field.
    const bad = agdaMcpServerBlockSchema.safeParse({ minAgdaVersion: "latest" });
    expect(bad.success).toBe(false);
    const ok = agdaMcpServerBlockSchema.safeParse({ minAgdaVersion: "2.6.4.3" });
    expect(ok.success).toBe(true);
  });
});

describe("server-version is decoupled from agdaMcpServer block", () => {
  test("getServerVersion returns the real package version, not the FALLBACK", () => {
    // Regression guard for PR #52 review #4: a typo in the range
    // metadata used to make this assertion fail (server reported
    // "0.0.0-dev"). The split parse keeps `version` valid even when
    // the range block is malformed.
    expect(getServerVersion()).not.toBe("0.0.0-dev");
    expect(getServerVersion()).toMatch(/^\d+\.\d+\.\d+/u);
  });

  test("parsePackageMetadata: malformed bound does not invalidate version", () => {
    // The exact scenario from PR #52 review #4. Pre-fix, the unified
    // .parse() rejected the whole shape, readPackageJsonOnce
    // swallowed the error, and SERVER_VERSION fell back to
    // "0.0.0-dev". Post-fix, version is preserved and only the bad
    // block is dropped.
    const result = parsePackageMetadata({
      version: "0.7.0",
      agdaMcpServer: { minAgdaVersion: "latest" },
    });
    expect(result.version).toBe("0.7.0");
    expect(result.agdaMcpServer).toBeUndefined();
  });

  test("parsePackageMetadata: valid block + valid version round-trip", () => {
    const result = parsePackageMetadata({
      version: "0.7.0",
      agdaMcpServer: { minAgdaVersion: "2.6.4.3", maxTestedAgdaVersion: "2.9.0" },
    });
    expect(result.version).toBe("0.7.0");
    expect(result.agdaMcpServer).toEqual({
      minAgdaVersion: "2.6.4.3",
      maxTestedAgdaVersion: "2.9.0",
    });
  });

  test("parsePackageMetadata: non-string version is dropped, block is preserved", () => {
    const result = parsePackageMetadata({
      version: 123,
      agdaMcpServer: { minAgdaVersion: "2.6.4.3" },
    });
    expect(result.version).toBeUndefined();
    expect(result.agdaMcpServer?.minAgdaVersion).toBe("2.6.4.3");
  });

  test("parsePackageMetadata: non-object input gives empty metadata", () => {
    for (const bogus of [null, undefined, "package.json", 42, []]) {
      const result = parsePackageMetadata(bogus);
      expect(result.version).toBeUndefined();
      expect(result.agdaMcpServer).toBeUndefined();
    }
  });
});
