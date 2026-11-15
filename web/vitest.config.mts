import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://lexicon:lexicon@localhost:5432/lexicon_test";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: "./tests/global-setup.ts",
    // The API tests share one database, so files must not run side by side.
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      LEXICON_INVITE_CODE: "test-invite",
      LEXICON_TIMEZONE: "UTC",
      // Never used for a real call: tests replace the tutor module.
      ANTHROPIC_API_KEY: "test-key",
    },
  },
});
