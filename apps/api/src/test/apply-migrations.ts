import { applyD1Migrations, env } from "cloudflare:test";

// Runs once per test file. With the pool's isolated storage, the post-setup
// state (schema applied, `secrets` empty) is snapshotted and restored after
// every `test()`, so individual tests never need to clean up after themselves.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
