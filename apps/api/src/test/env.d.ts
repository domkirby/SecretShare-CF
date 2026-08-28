import type { D1Migration } from "cloudflare:test";
import type { Env as ApiEnv } from "../routes/secrets";

// `env` from "cloudflare:test" is typed as `Cloudflare.Env`; make that the
// Worker's own binding shape plus the migrations list the pool injects.
declare global {
  namespace Cloudflare {
    interface Env extends ApiEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
