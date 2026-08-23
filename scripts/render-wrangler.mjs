#!/usr/bin/env node
/**
 * Render apps/<app>/wrangler.jsonc from apps/<app>/wrangler.jsonc.example plus
 * environment variables. Used by .github/workflows/deploy.yml; safe to run
 * locally too.
 *
 *   node scripts/render-wrangler.mjs api
 *   node scripts/render-wrangler.mjs frontend
 *
 * Deliberately dumb: parse the example as JSONC, assign a fixed list of keys
 * from a fixed list of environment variables, write JSON back out. There is no
 * templating language and no text substitution — every field this can touch is
 * listed in FIELDS below, and anything not listed there is copied through from
 * the example untouched.
 *
 * An env var that is unset or empty leaves the example's value in place, so a
 * forker only has to configure the values they actually want to change.
 * Fields marked `required: true` must be non-empty when --require-all is passed
 * (CI does), which is what turns a forgotten GitHub secret into a loud failure
 * instead of a deploy that silently points at the template's placeholder.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every field CI is allowed to set, per app.
 *   env    — environment variable read
 *   path   — location in the config object (array indices are numbers)
 *   required — must be non-empty under --require-all
 */
const FIELDS = {
  api: [
    { env: "CF_WORKER_NAME_API", path: ["name"] },
    { env: "D1_DATABASE_NAME", path: ["d1_databases", 0, "database_name"], required: true },
    { env: "D1_DATABASE_ID", path: ["d1_databases", 0, "database_id"], required: true },
    { env: "ALLOWED_ORIGIN", path: ["vars", "ALLOWED_ORIGIN"], required: true },
    { env: "TURNSTILE_ENABLED", path: ["vars", "TURNSTILE_ENABLED"] },
    { env: "MAX_SECRET_BYTES", path: ["vars", "MAX_SECRET_BYTES"] },
    { env: "DEFAULT_TTL_MINUTES", path: ["vars", "DEFAULT_TTL_MINUTES"] },
    { env: "MAX_TTL_MINUTES", path: ["vars", "MAX_TTL_MINUTES"] },
    { env: "MAX_VIEWS_CAP", path: ["vars", "MAX_VIEWS_CAP"] },
    { env: "FAILED_ATTEMPTS_CAP", path: ["vars", "FAILED_ATTEMPTS_CAP"] },
  ],
  frontend: [
    { env: "CF_WORKER_NAME_FRONTEND", path: ["name"] },
  ],
};

/**
 * Strip `//` and block comments from JSONC, character by character, respecting
 * string literals and escapes. Comment bytes are replaced with spaces so that
 * byte offsets in any JSON.parse error still line up with the source file.
 */
function stripJsonComments(text) {
  const out = [...text];
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      while (i < stop) {
        if (text[i] !== "\n") out[i] = " ";
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join("");
}

function setPath(root, path, value) {
  let node = root;
  for (const key of path.slice(0, -1)) {
    node = node[key];
    if (node === undefined || node === null) {
      throw new Error(`example config has no "${path.join(".")}" to set`);
    }
  }
  node[path.at(-1)] = value;
}

function main(argv) {
  const app = argv.find((a) => !a.startsWith("--"));
  const requireAll = argv.includes("--require-all");

  if (!Object.hasOwn(FIELDS, app ?? "")) {
    console.error(`usage: node scripts/render-wrangler.mjs <${Object.keys(FIELDS).join("|")}> [--require-all]`);
    process.exit(2);
  }

  const examplePath = join(repoRoot, "apps", app, "wrangler.jsonc.example");
  const outPath = join(repoRoot, "apps", app, "wrangler.jsonc");

  const config = JSON.parse(stripJsonComments(readFileSync(examplePath, "utf8")));

  const missing = [];
  const applied = [];
  for (const field of FIELDS[app]) {
    const value = process.env[field.env];
    if (value === undefined || value === "") {
      if (requireAll && field.required) missing.push(field.env);
      continue;
    }
    setPath(config, field.path, value);
    applied.push(`${field.env} -> ${field.path.join(".")}`);
  }

  if (missing.length > 0) {
    console.error(
      `render-wrangler: missing required environment variable(s) for "${app}": ${missing.join(", ")}\n` +
        "See DEPLOYMENT.md for the GitHub secrets/variables this workflow expects."
    );
    process.exit(1);
  }

  writeFileSync(outPath, JSON.stringify(config, null, 2) + "\n");

  // Every field here is non-secret config (names, origins, a D1 id, caps), but
  // log the mapping rather than the values — it is what you actually want when
  // debugging a deploy, and it keeps this honest if a secret is ever added.
  console.log(`render-wrangler: wrote ${outPath}`);
  for (const line of applied) console.log(`  ${line}`);
}

main(process.argv.slice(2));
