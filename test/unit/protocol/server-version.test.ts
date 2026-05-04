import { test, expect, describe } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  classifyAgdaAgainstSupportedRange,
  describeOutOfRangeWarning,
  getServerVersion,
  getSupportedAgdaRange,
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
});
