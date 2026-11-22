import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/ts/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
