# SecretShare API (`apps/api`)

A Hono (TypeScript) API running on Cloudflare Workers, backed by D1. Implements create/probe/reveal/delete for zero-knowledge secret sharing. The server only ever stores an opaque ciphertext envelope (`ivBase64:ciphertextBase64`) — it never sees plaintext, and in random-key mode it never sees the encryption key either.

This is a standalone npm package, deployed independently of `apps/frontend`.

## Requirements

- Node.js 20+
- A Cloudflare account (for deployment / remote D1)
- `wrangler` (installed as a dev dependency, invoked via `npm run` scripts)

## Setup

```bash
npm install
```

### Local D1 database

`wrangler dev` uses a local SQLite-backed D1 instance under `.wrangler/state/` — this works out of the box, no Cloudflare login required, but the schema needs to be applied once:

```bash
npm run db:migrate:local
```

### Remote D1 database (for deployment)

Create the real D1 database in your Cloudflare account:

```bash
npm run db:create
```

This prints a `database_id` — paste it into `wrangler.toml` under `[[d1_databases]]`. Then apply the schema to it:

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
| `npm run deploy` | `wrangler deploy` — manual/CLI deploy (not needed if using Cloudflare's git-connected "pull" deployment; see [`DEPLOYMENT.md`](../../DEPLOYMENT.md)) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:create` | Creates the remote D1 database |
| `npm run db:migrate:local` | Applies `schema.sql` to the local D1 instance |
| `npm run db:migrate:remote` | Applies `schema.sql` to the real, remote D1 database |
| `npm run db:query:local` | Ad hoc `wrangler d1 execute --local --command` for local debugging |

## Configuration

All configuration lives in `wrangler.toml` (plain vars) and Worker secrets (`wrangler secret put`, never committed). There is no `.env` file for a Worker — Wrangler is the source of truth for both dev and deployed config.

### `[vars]` (plain, non-secret)

| Var | Purpose | Current default |
|---|---|---|
| `ALLOWED_ORIGIN` | Comma-separated list of origins allowed via CORS. Must include every frontend origin (e.g. your Pages dev/preview/prod domains). | `http://localhost:5173,http://localhost:8788` |
| `TURNSTILE_ENABLED` | `"true"`/`"false"`. Gates Turnstile verification on `POST /api/secrets`. When `"false"`, `verifyTurnstile()` short-circuits to always pass — safe for local dev without a Turnstile site configured. | `"false"` |
| `MAX_SECRET_BYTES` | Max byte length of the `ciphertext` field accepted on create. Requests over this get a 413. | `"65536"` |
| `DEFAULT_TTL_MINUTES` | TTL applied when `ttlMinutes` is omitted on create. | `"1440"` (1 day) |
| `MAX_TTL_MINUTES` | Upper bound for `ttlMinutes`; requests over this get a 400. | `"10080"` (7 days) |
| `MAX_VIEWS_CAP` | Upper bound for `maxViews`; requests over this get a 400. | `"10"` |
| `FAILED_ATTEMPTS_CAP` | Max wrong-password guesses (via `POST /:id/verify-password`) before a password-protected secret is burned. Independent of `maxViews` — this budget exists so a typo doesn't cost the creator's configured view(s). | `"5"` |

### `[[d1_databases]]`

- `binding = "DB"` — the binding name used in code (`c.env.DB`).
- `database_name` / `database_id` — identify the actual D1 database. The committed `database_id` is a placeholder/dev value; replace it with your own database's ID after running `npm run db:create` (see [`DEPLOYMENT.md`](../../DEPLOYMENT.md) for the dashboard equivalent).

### `[triggers]`

- `crons = ["*/5 * * * *"]` — runs the `scheduled()` handler every 5 minutes, which deletes rows where `expires_at < now` or `burned = 1`. This replaces the original PHP tool's external cron script entirely — no separate scheduler or protected HTTP endpoint needed.

### Secrets (not in `wrangler.toml`)

| Secret | Purpose | Required when |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Server-side Turnstile `siteverify` key, POSTed to `https://challenges.cloudflare.com/turnstile/v0/siteverify` alongside the client's token on every create request. | Only read/required when `TURNSTILE_ENABLED = "true"`. If enabled but unset, verification always fails (fails closed, not open). |

Set via `wrangler secret put TURNSTILE_SECRET_KEY` (CLI) or the Cloudflare dashboard's Worker settings (see `DEPLOYMENT.md`). For local dev, put it in a gitignored `.dev.vars` file instead (`TURNSTILE_ENABLED=true` / `TURNSTILE_SECRET_KEY=...`) — see [Cloudflare's Turnstile testing keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) for dummy site/secret keys that always pass or always fail, useful for exercising this locally without a real Turnstile site.

The server always re-verifies the token itself when `TURNSTILE_ENABLED` is `"true"` — a modified or no-JS frontend can't bypass this by simply omitting `turnstileToken`, since a missing token fails verification the same as an invalid one.

## API contract

Base path: `/api/secrets`. All error responses are `{ "error": string }` with a non-2xx status.

### `POST /api/secrets`

Create a secret.

```jsonc
// request
{
  "ciphertext": "ivB64:ctB64",
  "kdf": { "salt": "b64", "iterations": 350000, "verifier": "b64" }, // optional — omit entirely for random-key mode
  "maxViews": 1,
  "ttlMinutes": 1440,        // optional, defaults to DEFAULT_TTL_MINUTES
  "turnstileToken": "..."    // required when TURNSTILE_ENABLED="true"; ignored otherwise
}

// response 201
{ "id": "kQ2f...", "expiresAt": "2026-07-19T18:00:00Z" }
```

Validation: `ciphertext` non-empty and ≤ `MAX_SECRET_BYTES` (413 if over), `maxViews` integer 1–`MAX_VIEWS_CAP` (400), `ttlMinutes` integer 1–`MAX_TTL_MINUTES` if provided (400), `kdf.salt`/`kdf.iterations`/`kdf.verifier` required together if `kdf` is present (400). `kdf.verifier` is an independent PBKDF2 derivation from the same password (see [`apps/frontend/README.md`](../frontend/README.md)) — it lets `/verify-password` check a password without ever touching the actual encryption key.

### `GET /api/secrets/:id`

Metadata probe — does **not** consume a view.

```jsonc
// response 200 (random-key mode)
{ "exists": true, "requiresPassword": false, "viewsRemaining": 1, "expiresAt": "..." }
// response 200 (password mode) — kdf.salt/iterations are not secret, needed client-side to derive a verifier before calling /verify-password
{ "exists": true, "requiresPassword": true, "kdf": { "salt": "b64", "iterations": 350000 }, "viewsRemaining": 1, "expiresAt": "..." }
// response 404 (expired / burned / never existed — indistinguishable by design)
{ "exists": false }
```

### `POST /api/secrets/:id/verify-password`

Checks a password-derived verifier **without consuming a view** — this is what lets `RevealSecret.vue` catch a typo before it costs the one real reveal.

```jsonc
// request
{ "verifier": "b64" } // deriveVerifier(password, salt, iterations) client-side

// response 200
{ "valid": true }   // or { "valid": false }
// response 404 (missing / burned / expired / not a password secret — same uniform 404 as elsewhere)
{ "error": "not found" }
```

A mismatch increments a per-secret `failed_attempts` counter; once it reaches `FAILED_ATTEMPTS_CAP`, the row is burned (hard-deleted) the same way `/reveal` burns on `maxViews` exhaustion. This bounds total guesses the same way the rest of the app does — a wrong guess is cheap for the server, but the attacker still has to run a full 350,000-iteration PBKDF2 client-side per guess, same cost as before this endpoint existed. The comparison itself is constant-time (`src/lib/timingSafeEqual.ts`) to avoid a length/content timing side-channel on the verifier string.

### `POST /api/secrets/:id/reveal`

Atomically consumes one view.

```jsonc
// response 200
{ "ciphertext": "ivB64:ctB64", "kdf": { "salt": "b64", "iterations": 350000 } } // "kdf" omitted entirely in random-key mode
// response 404
{ "error": "not found" }
```

Uses a single `UPDATE ... WHERE view_count < max_views AND burned = 0 AND expires_at >= now() RETURNING ...` statement, so two concurrent reveals on a `maxViews: 1` secret can't both succeed. If this reveal exhausts `max_views`, the row is deleted immediately.

### `DELETE /api/secrets/:id`

Burns the secret immediately. Always returns `204`, whether or not the secret existed — deletion is authorized purely by possession of the id/link, the same trust boundary as viewing, so there's nothing to leak either way.

## Data model (D1)

See `schema.sql`. One table, `secrets`, no `users` table — this is an anonymous, link-possession-based tool.

## Known gaps (planned follow-up passes)

- **Rate limiting**: not implemented in-Worker; use Cloudflare's dashboard Rate Limiting Rules on `POST /api/secrets`, `POST /api/secrets/:id/reveal`, and especially `POST /api/secrets/:id/verify-password` (its whole purpose is to accept repeated guesses cheaply, so it's the best candidate for a dashboard rate limit rule once that pass happens) in the meantime — see `DEPLOYMENT.md`.
