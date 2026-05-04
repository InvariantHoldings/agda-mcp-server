import { test, expect, describe } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  agdaVersionStringSchema,
  classifyAgdaAgainstSupportedRange,
  describeOutOfRangeWarning,
  getServerVersion,
  getSupportedAgdaRange,
  packageMetadataSchema,
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
});
