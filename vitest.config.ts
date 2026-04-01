import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/examples/**/*.test.ts",
      "test/unit/**/*.test.ts",
      "test/property/**/*.test.ts",
      "test/integration/**/*.test.ts",
    ],
    testTimeout: 30_000,
  },
});
