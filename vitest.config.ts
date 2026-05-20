import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // LLM calls can take 30–60s on first request (cold model load). Give
    // each test 2 min before vitest aborts.
    testTimeout: 120_000,
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    },
  },
});