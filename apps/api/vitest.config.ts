import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The route handlers own the one-time-view and failed-attempt invariants, and
// those rest on real SQLite behaviour (RETURNING, datetime('now'), UNIQUE
// violations, statement serialization). Run them in a real workerd + a real
// in-memory D1 rather than against mocks.
//
// Config is inline rather than `wrangler: { configPath }` on purpose:
// apps/api/wrangler.jsonc is gitignored and only rendered at deploy time, so
// tests must not depend on it, and a committed wrangler-shaped file would be a
// trap for scripts/render-wrangler.mjs and the `config` CI job.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        main: "./src/index.ts",
        miniflare: {
          compatibilityDate: "2026-07-23", // keep in sync with wrangler.jsonc.example
          d1Databases: ["DB"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            ALLOWED_ORIGIN: "https://test.example",
            TURNSTILE_ENABLED: "false",
            // Deliberately non-default caps: the handlers read these from
            // `vars` at request time, and the tests assert the observed
            // limits match these values, not the wrangler.jsonc.example
            // defaults (65536 / 1440 / 10080 / 10 / 5).
            MAX_SECRET_BYTES: "64",
            DEFAULT_TTL_MINUTES: "30",
            MAX_TTL_MINUTES: "120",
            MAX_VIEWS_CAP: "3",
            FAILED_ATTEMPTS_CAP: "2",
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./src/test/apply-migrations.ts"],
  },
});
