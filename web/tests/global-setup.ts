import { execFileSync } from "node:child_process";

/** Bring the test database up to the current schema before any test runs. */
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? "postgresql://lexicon:lexicon@localhost:5432/lexicon_test";
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
