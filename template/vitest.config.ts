import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Gives each run a temp folder of its own and removes it after, so test copies don't pile up.
    globalSetup: ["test/temp-dir.ts"],
    // Each build test runs a full `astro build`; builds share the project's caches, so run files one at a time.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
