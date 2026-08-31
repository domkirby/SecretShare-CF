/**
 * Tests for render-wrangler.mjs — run with `node --test scripts/`.
 *
 * Uses only node:test / node:assert, so this suite needs no install step and
 * no dependencies. Most tests drive the script as a subprocess writing to a
 * temp directory, so they can't clobber a developer's local
 * apps/<app>/wrangler.jsonc — but note that isolation is itself a hazard: it
 * means the common `render()` helper always passes `--out`, so it does NOT
 * exercise the bare command line the deploy workflow uses. See the
 * "argument parsing" and "deploy workflow invocation" blocks below, which
 * cover that form directly.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./render-wrangler.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts", "render-wrangler.mjs");

let workDir;
before(() => {
  workDir = mkdtempSync(join(tmpdir(), "render-wrangler-"));
});
after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// Each render gets its own output path, so a test that expects nothing to be
// written can't read a file an earlier test left behind.
let renderCount = 0;

/** Run the script; returns { status, stdout, stderr, config }. */
function render(app, env = {}, { requireAll = false } = {}) {
  const outPath = join(workDir, `${app}-${renderCount++}.jsonc`);
  const args = [script, app, "--out", outPath];
  if (requireAll) args.push("--require-all");

  let status = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync(process.execPath, args, {
      // A clean env, so a variable that happens to be set in the shell running
      // the tests can't silently satisfy a case that's meant to fail.
      env: { PATH: process.env.PATH, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    status = err.status ?? 1;
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? "";
  }

  let config;
  try {
    config = JSON.parse(readFileSync(outPath, "utf8"));
  } catch {
    config = undefined;
  }
  return { status, stdout, stderr, config };
}

describe("committed examples", () => {
  for (const app of ["api", "frontend"]) {
    test(`${app}: renders with no environment set`, () => {
      const { status, config } = render(app);
      assert.equal(status, 0);
      assert.ok(config, "expected a config to be written");
    });

    test(`${app}: output is plain JSON that Wrangler can parse`, () => {
      const { config } = render(app);
      // Round-tripping proves the comment stripper produced valid JSON and the
      // writer emitted it without reintroducing comments.
      assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
    });
  }

  test("api example keeps every binding the Worker code depends on", () => {
    const { config } = render("api");
    assert.equal(config.main, "src/index.ts");
    assert.ok(config.compatibility_date, "compatibility_date is required by Wrangler");
    assert.equal(config.d1_databases[0].binding, "DB");
    assert.deepEqual(config.triggers.crons, ["*/5 * * * *"]);
    for (const v of [
      "ALLOWED_ORIGIN",
      "TURNSTILE_ENABLED",
      "MAX_SECRET_BYTES",
      "DEFAULT_TTL_MINUTES",
      "MAX_TTL_MINUTES",
      "MAX_VIEWS_CAP",
      "FAILED_ATTEMPTS_CAP",
    ]) {
      assert.ok(v in config.vars, `vars.${v} missing from the example`);
    }
  });

  test("api example never ships a Turnstile secret", () => {
    const { config } = render("api", { TURNSTILE_ENABLED: "true" });
    assert.ok(
      !("TURNSTILE_SECRET_KEY" in config.vars),
      "TURNSTILE_SECRET_KEY must be a Worker secret, never a plain var"
    );
  });

  test("frontend example serves the SPA fallback from dist", () => {
    const { config } = render("frontend");
    assert.equal(config.assets.directory, "./dist");
    assert.equal(config.assets.not_found_handling, "single-page-application");
  });

  test("frontend example runs the header Worker in front of the assets", () => {
    // All three matter together: without `main` there is no code to set the
    // security headers, without the binding that code cannot serve the files,
    // and without run_worker_first the asset router answers /assets/*.js
    // before the Worker ever sees the request.
    const { config } = render("frontend");
    assert.equal(config.main, "./worker/index.ts");
    assert.equal(config.assets.binding, "ASSETS");
    assert.equal(config.assets.run_worker_first, true);
    assert.ok("API_ORIGIN" in config.vars, "vars.API_ORIGIN missing from the example");
  });
});

describe("environment overrides", () => {
  test("applies every api field", () => {
    const { config } = render("api", {
      CF_WORKER_NAME_API: "my-api",
      D1_DATABASE_NAME: "my-db",
      D1_DATABASE_ID: "11111111-2222-3333-4444-555555555555",
      ALLOWED_ORIGIN: "https://secret.example.com",
      TURNSTILE_ENABLED: "true",
      MAX_SECRET_BYTES: "1024",
      DEFAULT_TTL_MINUTES: "60",
      MAX_TTL_MINUTES: "120",
      MAX_VIEWS_CAP: "3",
      FAILED_ATTEMPTS_CAP: "2",
    });
    assert.equal(config.name, "my-api");
    assert.equal(config.d1_databases[0].database_name, "my-db");
    assert.equal(config.d1_databases[0].database_id, "11111111-2222-3333-4444-555555555555");
    assert.equal(config.vars.ALLOWED_ORIGIN, "https://secret.example.com");
    assert.equal(config.vars.TURNSTILE_ENABLED, "true");
    assert.equal(config.vars.MAX_SECRET_BYTES, "1024");
    assert.equal(config.vars.DEFAULT_TTL_MINUTES, "60");
    assert.equal(config.vars.MAX_TTL_MINUTES, "120");
    assert.equal(config.vars.MAX_VIEWS_CAP, "3");
    assert.equal(config.vars.FAILED_ATTEMPTS_CAP, "2");
  });

  test("applies every frontend field", () => {
    const { config } = render("frontend", {
      CF_WORKER_NAME_FRONTEND: "my-frontend",
      API_ORIGIN: "https://shareapi.example.com",
    });
    assert.equal(config.name, "my-frontend");
    assert.equal(config.vars.API_ORIGIN, "https://shareapi.example.com");
  });

  test("an unset variable leaves the example's value alone", () => {
    const { config: base } = render("api");
    const { config } = render("api", { ALLOWED_ORIGIN: "https://only-this.example.com" });
    assert.equal(config.vars.ALLOWED_ORIGIN, "https://only-this.example.com");
    assert.equal(config.vars.MAX_SECRET_BYTES, base.vars.MAX_SECRET_BYTES);
    assert.equal(config.name, base.name);
  });

  test("an empty variable is treated as unset, not as an empty value", () => {
    // GitHub Actions expands an undefined `vars.X` to "", so this is the
    // difference between falling back to the example and deploying a Worker
    // with an empty CORS allowlist.
    const { config: base } = render("api");
    const { config } = render("api", { ALLOWED_ORIGIN: "" });
    assert.equal(config.vars.ALLOWED_ORIGIN, base.vars.ALLOWED_ORIGIN);
  });

  test("does not read a variable belonging to the other app", () => {
    const { config } = render("frontend", { CF_WORKER_NAME_API: "my-api" });
    assert.notEqual(config.name, "my-api");
  });

  test("sets only mapped fields, leaving the rest of the example intact", () => {
    const { config } = render("api", { ALLOWED_ORIGIN: "https://x.example.com" });
    assert.equal(config.main, "src/index.ts");
    assert.equal(config.d1_databases[0].binding, "DB");
    assert.deepEqual(config.triggers.crons, ["*/5 * * * *"]);
  });

  test("an env var cannot inject structure into the config", () => {
    // Values are assigned, never parsed or interpolated, so JSON-ish input
    // lands as an inert string.
    const injected = '{"vars":{"TURNSTILE_ENABLED":"false"}}';
    const { config } = render("api", { ALLOWED_ORIGIN: injected });
    assert.equal(config.vars.ALLOWED_ORIGIN, injected);
    assert.equal(config.vars.TURNSTILE_ENABLED, "false");
    assert.equal(typeof config.vars.ALLOWED_ORIGIN, "string");
  });
});

describe("--require-all", () => {
  const complete = {
    D1_DATABASE_NAME: "my-db",
    D1_DATABASE_ID: "11111111-2222-3333-4444-555555555555",
    ALLOWED_ORIGIN: "https://secret.example.com",
  };

  test("passes when every required variable is set", () => {
    const { status, config } = render("api", complete, { requireAll: true });
    assert.equal(status, 0);
    assert.equal(config.vars.ALLOWED_ORIGIN, "https://secret.example.com");
  });

  test("fails, and names the variable, when one is missing", () => {
    for (const missing of Object.keys(complete)) {
      const env = { ...complete };
      delete env[missing];
      const { status, stderr } = render("api", env, { requireAll: true });
      assert.equal(status, 1, `expected a failure when ${missing} is unset`);
      assert.match(stderr, new RegExp(missing));
    }
  });

  test("fails rather than deploying against the example's placeholder D1 id", () => {
    const { status, config } = render("api", {}, { requireAll: true });
    assert.equal(status, 1);
    assert.equal(config, undefined, "no config should be written on failure");
  });

  test("frontend fails rather than shipping a CSP pointing at localhost", () => {
    const { status, stderr, config } = render("frontend", {}, { requireAll: true });
    assert.equal(status, 1);
    assert.match(stderr, /API_ORIGIN/);
    assert.equal(config, undefined, "no config should be written on failure");
  });

  test("frontend passes once API_ORIGIN is set", () => {
    const { status, config } = render(
      "frontend",
      { API_ORIGIN: "https://shareapi.example.com" },
      { requireAll: true }
    );
    assert.equal(status, 0);
    assert.equal(config.vars.API_ORIGIN, "https://shareapi.example.com");
  });
});

describe("JSONC comment handling", () => {
  test("a // inside a string value survives", () => {
    // The stripper is character-based rather than a regex over the file text
    // precisely so that a URL in ALLOWED_ORIGIN isn't truncated at its "//".
    const { config } = render("api", { ALLOWED_ORIGIN: "https://a.example.com" });
    assert.equal(config.vars.ALLOWED_ORIGIN, "https://a.example.com");
  });

  test("comments are gone from the rendered output", () => {
    const { config } = render("api");
    const text = JSON.stringify(config);
    assert.ok(!text.includes("fill in"), "example comment text leaked into output");
    assert.ok(!text.includes("CI override"), "example comment text leaked into output");
  });
});

describe("argument handling", () => {
  test("rejects an unknown app", () => {
    const { status, stderr } = render("nope");
    assert.equal(status, 2);
    assert.match(stderr, /usage:/);
  });

  test("rejects --out with no path", () => {
    let status = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [script, "api", "--out"], {
        env: { PATH: process.env.PATH },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      status = err.status ?? 1;
      stderr = err.stderr ?? "";
    }
    assert.equal(status, 2);
    assert.match(stderr, /usage:/);
  });

  test("logs which field each variable set, without printing values", () => {
    // A non-URL sentinel: this asserts the value isn't echoed, and a URL-shaped
    // literal in an .includes() check trips CodeQL's incomplete-url-substring-
    // sanitization rule for no benefit — nothing here validates a URL.
    const sentinel = "sentinel-value-must-not-be-logged";
    const { stdout } = render("api", { ALLOWED_ORIGIN: sentinel });
    assert.match(stdout, /ALLOWED_ORIGIN -> vars\.ALLOWED_ORIGIN/);
    assert.ok(!stdout.includes(sentinel), "the log should name fields, not echo their values");
  });
});

describe("argument parsing", () => {
  // Regression: the deploy workflow runs the script with no --out, and an
  // earlier index-arithmetic parser dropped argv[0] in exactly that case,
  // failing every deploy with a usage banner. The suite missed it because
  // render() above always passes --out.
  test("the deploy workflow's own invocation parses", () => {
    assert.deepEqual(parseArgs(["api", "--require-all"]), {
      app: "api",
      requireAll: true,
      outOverride: undefined,
    });
    assert.deepEqual(parseArgs(["frontend", "--require-all"]), {
      app: "frontend",
      requireAll: true,
      outOverride: undefined,
    });
  });

  test("the app alone parses", () => {
    for (const app of ["api", "frontend"]) {
      assert.deepEqual(parseArgs([app]), { app, requireAll: false, outOverride: undefined });
    }
  });

  test("--out is picked up, and its value is not mistaken for the app", () => {
    assert.deepEqual(parseArgs(["api", "--out", "/tmp/x.jsonc"]), {
      app: "api",
      requireAll: false,
      outOverride: "/tmp/x.jsonc",
    });
  });

  test("flags parse in any order", () => {
    const expected = { app: "api", requireAll: true, outOverride: "/tmp/x.jsonc" };
    assert.deepEqual(parseArgs(["api", "--out", "/tmp/x.jsonc", "--require-all"]), expected);
    assert.deepEqual(parseArgs(["api", "--require-all", "--out", "/tmp/x.jsonc"]), expected);
    assert.deepEqual(parseArgs(["--require-all", "--out", "/tmp/x.jsonc", "api"]), expected);
  });

  test("an app named like a flag value is still rejected", () => {
    // "--out api" consumes api as the path, leaving no app.
    assert.match(parseArgs(["--out", "api"]).error, /unknown app/);
  });

  test("rejects bad input", () => {
    assert.match(parseArgs([]).error, /unknown app/);
    assert.match(parseArgs(["nope"]).error, /unknown app nope/);
    assert.match(parseArgs(["api", "--out"]).error, /--out requires a path/);
    assert.match(parseArgs(["api", "--bogus"]).error, /unknown option --bogus/);
    assert.match(parseArgs(["api", "frontend"]).error, /unexpected argument frontend/);
  });
});

describe("deploy workflow invocation", () => {
  // End-to-end coverage of the exact command .github/workflows/deploy.yml runs,
  // with no --out, writing to the default apps/<app>/wrangler.jsonc. The unit
  // tests above only prove the parser agrees with itself; this proves the real
  // command line works. Any pre-existing local config is restored afterwards.
  function runDefaultOutput(app, env) {
    const target = join(repoRoot, "apps", app, "wrangler.jsonc");
    const had = existsSync(target);
    const previous = had ? readFileSync(target, "utf8") : undefined;
    try {
      const stdout = execFileSync(process.execPath, [script, app, "--require-all"], {
        env: { PATH: process.env.PATH, ...env },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { stdout, config: JSON.parse(readFileSync(target, "utf8")) };
    } finally {
      if (had) writeFileSync(target, previous);
      else rmSync(target, { force: true });
    }
  }

  test("api renders to the default path", () => {
    const { config } = runDefaultOutput("api", {
      D1_DATABASE_NAME: "my-db",
      D1_DATABASE_ID: "11111111-2222-3333-4444-555555555555",
      ALLOWED_ORIGIN: "https://secret.example.com",
    });
    assert.equal(config.d1_databases[0].database_name, "my-db");
    assert.equal(config.vars.ALLOWED_ORIGIN, "https://secret.example.com");
  });

  test("frontend renders to the default path", () => {
    const { config } = runDefaultOutput("frontend", { API_ORIGIN: "https://shareapi.example.com" });
    assert.equal(config.assets.directory, "./dist");
    assert.equal(config.vars.API_ORIGIN, "https://shareapi.example.com");
  });
});
