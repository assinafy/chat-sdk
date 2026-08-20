import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 75,
        statements: 90,
      },
    },
  },
});
