import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Gives each run a temp folder of its own and removes it after, so test copies don't pile up.
    globalSetup: ["test/temp-dir.ts"],
  },
});
