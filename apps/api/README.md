# SecretShare API (`apps/api`)

A Hono (TypeScript) API running on Cloudflare Workers, backed by D1. Implements create/probe/reveal/delete for zero-knowledge secret sharing. The server only ever stores an opaque ciphertext envelope (`v1:ivBase64:ciphertextBase64`) — it never sees plaintext, and in random-key mode it never sees the encryption key either.

This is a standalone npm package, deployed independently of `apps/frontend`.

## Requirements

- Node.js 20+
- A Cloudflare account (for deployment / remote D1)
- `wrangler` (installed as a dev dependency, invoked via `npm run` scripts)

## Setup

```bash
npm install
cp wrangler.jsonc.example wrangler.jsonc
```

`wrangler.jsonc` is gitignored — it holds your own deployment's values and is never committed. `wrangler.jsonc.example` is the committed template, with a comment on every field explaining what to put there. For purely local work you can leave its placeholders alone.

### Local D1 database

`wrangler dev` uses a local SQLite-backed D1 instance under `.wrangler/state/` — this works out of the box, no Cloudflare login required, but the migrations need to be applied once:

```bash
npm run db:migrate:local
```

### Remote D1 database (for deployment)

Create the real D1 database in your Cloudflare account:

```bash
npm run db:create
```

This prints a `database_id`. In CI it comes from the `D1_DATABASE_ID` GitHub secret (see [`DEPLOYMENT.md`](../../DEPLOYMENT.md)); for deploying by hand, put it in your local `wrangler.jsonc` under `d1_databases`. Migrations are applied automatically by the deploy workflow, but you can also run them yourself:

```bash
npm run db:migrate:remote
```

## Running locally

```bash
npm run dev
```

Starts the Worker on `http://localhost:8787`. `GET /health` returns `{ "ok": true }` once it's up.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | `wrangler dev` — local Worker + local D1 |
| `npm run deploy` | `wrangler deploy` — manual/CLI deploy from your machine. Not needed normally: pushing to `main` deploys via GitHub Actions (see [`DEPLOYMENT.md`](../../DEPLOYMENT.md)) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:create` | Creates the remote D1 database |
| `npm run db:migrate:local` | Applies pending `migrations/` to the local D1 instance |
| `npm run db:migrate:remote` | Applies pending `migrations/` to the real, remote D1 database |
| `npm run db:migrations:list` | Shows which `migrations/` are still unapplied remotely |
| `npm run db:query:local` | Ad hoc `wrangler d1 execute --local --command` for local debugging |

## Configuration

All configuration lives in `wrangler.jsonc` (plain vars) and Worker secrets (`wrangler secret put`, never committed). There is no `.env` file for a Worker — Wrangler is the source of truth for both dev and deployed config.

`wrangler.jsonc` itself is gitignored. Locally you create it with `cp wrangler.jsonc.example wrangler.jsonc`; in CI it is generated from that same example by `scripts/render-wrangler.mjs`, which overwrites a fixed list of fields from GitHub secrets/variables — so the values below are set in one of those two places, never committed.

### `vars` (plain, non-secret)

| Var | Purpose | Current default |
|---|---|---|
| `ALLOWED_ORIGIN` | Comma-separated list of origins allowed via CORS. Must include every frontend origin (e.g. your frontend's dev/preview/prod Workers domains). | `http://localhost:5173,http://localhost:8788` |
| `TURNSTILE_ENABLED` | `"true"`/`"false"`. Gates Turnstile verification on `POST /api/secrets` and `POST /:id/reveal`. When `"false"`, `verifyTurnstile()` short-circuits to always pass — safe for local dev without a Turnstile site configured. | `"false"` |
| `MAX_SECRET_BYTES` | Max byte length of the `ciphertext` field accepted on create. Requests over this get a 413. | `"65536"` |
| `DEFAULT_TTL_MINUTES` | TTL applied when `ttlMinutes` is omitted on create. | `"1440"` (1 day) |
| `MAX_TTL_MINUTES` | Upper bound for `ttlMinutes`; requests over this get a 400. | `"10080"` (7 days) |
| `MAX_VIEWS_CAP` | Upper bound for `maxViews`; requests over this get a 400. | `"10"` |
| `FAILED_ATTEMPTS_CAP` | Max wrong-password guesses (via `POST /:id/reveal`) before a password-protected secret is burned. Independent of `maxViews` — a wrong guess never consumes a view, so this budget exists purely to bound total guesses. | `"5"` |

### `d1_databases`

- `binding: "DB"` — the binding name used in code (`c.env.DB`). The npm scripts address the database by this binding rather than by name, so they work unmodified in any fork.
- `database_name` / `database_id` — identify the actual D1 database. The example file's `database_id` is a placeholder; supply your own via the `D1_DATABASE_NAME` variable and `D1_DATABASE_ID` secret in CI, or in your local `wrangler.jsonc` after running `npm run db:create` (see [`DEPLOYMENT.md`](../../DEPLOYMENT.md)).

### `triggers`

- `crons: ["*/5 * * * *"]` — runs the `scheduled()` handler every 5 minutes, which deletes rows where `expires_at < now` or `burned = 1`. This replaces the original PHP tool's external cron script entirely — no separate scheduler or protected HTTP endpoint needed.

### Secrets (not in `wrangler.jsonc`)

| Secret | Purpose | Required when |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Server-side Turnstile `siteverify` key, POSTed to `https://challenges.cloudflare.com/turnstile/v0/siteverify` alongside the client's token on every create or reveal request. | Only read/required when `TURNSTILE_ENABLED = "true"`. If enabled but unset, verification always fails (fails closed, not open). |

Set via `wrangler secret put TURNSTILE_SECRET_KEY` (CLI) or the Cloudflare dashboard's Worker settings. The deploy workflow does this for you from the `TURNSTILE_SECRET_KEY` GitHub secret whenever the `TURNSTILE_ENABLED` variable is `true` (see `DEPLOYMENT.md`) — it is never written into `wrangler.jsonc`. For local dev, put it in a gitignored `.dev.vars` file instead (`TURNSTILE_ENABLED=true` / `TURNSTILE_SECRET_KEY=...`) — see [Cloudflare's Turnstile testing keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) for dummy site/secret keys that always pass or always fail, useful for exercising this locally without a real Turnstile site.

The server always re-verifies the token itself when `TURNSTILE_ENABLED` is `"true"` — a modified or no-JS frontend can't bypass this by simply omitting `turnstileToken`, since a missing token fails verification the same as an invalid one. Revealing a password-protected secret is a single `POST /:id/reveal` call (password check and view consumption happen together), so it only ever needs one token per attempt — no token queuing/replay concerns like a multi-call flow would have.

## API contract

Base path: `/api/secrets`. All error responses are `{ "error": string }` with a non-2xx status.

### `POST /api/secrets`

Create a secret.

```jsonc
// request
{
  "id": "kQ2f...",           // client-generated, 22 base64url chars (128 bits); bound into the ciphertext as AES-GCM AAD
  "ciphertext": "v1:ivB64:ctB64",
  "kdf": { "salt": "b64", "iterations": 600000, "verifier": "b64" }, // optional — omit entirely for random-key mode
  "maxViews": 1,
  "ttlMinutes": 1440,        // optional, defaults to DEFAULT_TTL_MINUTES
  "turnstileToken": "..."    // required when TURNSTILE_ENABLED="true"; ignored otherwise
}

// response 201
{ "id": "kQ2f...", "expiresAt": "2026-07-19T18:00:00Z" }
```

Validation: `id` must match `^[A-Za-z0-9_-]{22}$` (400; 409 if a secret with that id already exists — with 128-bit random ids a genuine collision is negligible, so a 409 in practice means a replayed request). The id is generated client-side *before* encryption because it doubles as the AES-GCM additional authenticated data, cryptographically binding the ciphertext to its record. `ciphertext` non-empty and ≤ `MAX_SECRET_BYTES` (413 if over), `maxViews` integer 1–`MAX_VIEWS_CAP` (400), `ttlMinutes` integer 1–`MAX_TTL_MINUTES` if provided (400), `kdf.salt`/`kdf.iterations`/`kdf.verifier` required together if `kdf` is present, with `iterations` in 100,000–2,000,000 (400).

`kdf.verifier` in the request is an HKDF-SHA256 expansion (info label `secretshare:v1:verify`) of the client's single-block PBKDF2 master secret — the encryption key is expanded from the same master under a different label and never leaves the browser (see [`apps/frontend/README.md`](../frontend/README.md)). The server does **not** store that value as-is: it computes `HMAC-SHA256(key = salt, message = verifier)` (`src/lib/verifierHash.ts`) and persists the HMAC output in `kdf_verifier` instead. The verifier is already high-entropy HKDF output, so this isn't password-strengthening — it just means a raw DB read doesn't hand over a value an attacker could replay as-is against `/reveal`; forging a match still requires knowing the actual verifier, not just its hash.

### `GET /api/secrets/:id`

Metadata probe — does **not** consume a view.

```jsonc
// response 200 (random-key mode)
{ "exists": true, "requiresPassword": false, "viewsRemaining": 1, "expiresAt": "..." }
// response 200 (password mode) — kdf.salt/iterations are not secret, needed client-side to derive a verifier before calling /reveal
{ "exists": true, "requiresPassword": true, "kdf": { "salt": "b64", "iterations": 600000 }, "viewsRemaining": 1, "expiresAt": "..." }
// response 404 (expired / burned / never existed — indistinguishable by design)
{ "exists": false }
```

### `POST /api/secrets/:id/reveal`

Verifies the password (if any) and atomically consumes one view in a single call — there is no separate password-check step. A wrong password is rejected here without consuming a view, so a typo can be retried for free.

```jsonc
// request (turnstileToken required when TURNSTILE_ENABLED="true"; verifier required only for password-protected secrets)
{
  "verifier": "b64",         // verifier half of deriveKeyAndVerifier(password, salt, iterations) client-side; omit for random-key mode
  "turnstileToken": "..."
}

// response 200 — kdf is not returned here: the client already derived the key from the probe response's salt/iterations
{ "ciphertext": "v1:ivB64:ctB64" }
// response 400 (password-protected secret and `verifier` is missing/empty)
{ "error": "verifier is required" }
// response 401 (password-protected secret and `verifier` doesn't match — view NOT consumed)
{ "error": "invalid password" }
// response 403 (TURNSTILE_ENABLED="true" and the token is missing/invalid — checked before anything else, so a rejected token never burns a view or a guess)
{ "error": "Turnstile verification failed" }
// response 404 (missing / burned / expired / views exhausted — same uniform 404 as elsewhere)
{ "error": "not found" }
```

For password-protected secrets, the server recomputes `HMAC-SHA256(key = salt, message = verifier)` (`src/lib/verifierHash.ts`) and compares it against the stored `kdf_verifier` with a constant-time comparison (`src/lib/timingSafeEqual.ts`) to avoid a length/content timing side-channel. A mismatch increments a per-secret `failed_attempts` counter *without* touching `view_count`; once `failed_attempts` reaches `FAILED_ATTEMPTS_CAP`, the row is burned (hard-deleted) the same way a successful reveal burns on `maxViews` exhaustion. This bounds total guesses cheaply on the server side, but the attacker still has to run a full 600,000-iteration PBKDF2 client-side per guess to produce a candidate verifier in the first place.

Only once the password check passes (or the secret has no password) does the handler run the view-consuming step: a single `UPDATE ... WHERE view_count < max_views AND burned = 0 AND expires_at >= now() RETURNING ...` statement, so two concurrent reveals on a `maxViews: 1` secret can't both succeed. If this reveal exhausts `max_views`, the row is deleted immediately.

### `DELETE /api/secrets/:id`

Burns the secret immediately. Always returns `204`, whether or not the secret existed — deletion is authorized purely by possession of the id/link, the same trust boundary as viewing, so there's nothing to leak either way.

## Data model (D1)

See [`migrations/0001_create_secrets.sql`](migrations/0001_create_secrets.sql). One table, `secrets`, no `users` table — this is an anonymous, link-possession-based tool.

Schema changes go in a new numbered file under `migrations/`; never edit an already-applied one. Wrangler tracks what it has applied in a `d1_migrations` table and skips those, so `wrangler d1 migrations apply DB --remote` is safe to run on every deploy — which is exactly what the deploy workflow does.

## Known gaps (planned follow-up passes)

- **Rate limiting**: not implemented in-Worker; use Cloudflare's dashboard Rate Limiting Rules on `POST /api/secrets` and especially `POST /api/secrets/:id/reveal` (a wrong-password guess against it is cheap for the server and doesn't consume a view, so it's the best candidate for a dashboard rate limit rule once that pass happens) in the meantime — see `DEPLOYMENT.md`.
