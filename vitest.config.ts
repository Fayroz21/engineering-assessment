import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["{apps,packages}/**/src/**/*.test.ts"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html"],
      include: ["{apps,packages}/*/src/**/*.ts"],
      exclude: [
        "**/__tests__/**",
        "**/generated/**",
        "apps/api/src/server.ts",
        "apps/worker/src/index.ts",
      ],
      thresholds: {
        // The partner event slice carries the guarantees, so it is held to a
        // higher bar than the rest of the repository.
        "apps/api/src/**": { lines: 90, branches: 90, functions: 90 },
        "packages/contracts/src/**": { lines: 90, branches: 90, functions: 90 },
        lines: 80,
        branches: 80,
        functions: 80,
      },
    },
  },
});
