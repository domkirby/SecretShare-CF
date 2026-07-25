# SecretShare Frontend (`apps/frontend`)

A Vue 3 + Vite SPA deployed as a Cloudflare Workers static-assets project. This is the browser-side half of the zero-knowledge model: all encryption and decryption happen here, in-browser, via WebCrypto. The server (`apps/api`) never sees plaintext, and never sees the key or password either.

This is a standalone npm package, deployed independently of `apps/api` — it only needs to know the API's base URL.

Supports both **random-key mode** and **password mode**, plus an optional Turnstile challenge on both creation and reveal. Rate-limiting UI is a planned follow-up pass.

## Requirements

- Node.js 20+
- A running instance of `apps/api` (local `wrangler dev`, or a deployed Worker) to point at

## Setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` if your API isn't at the default local address.

## Running locally

```bash
npm run dev
```

Starts Vite on `http://localhost:5173`. Make sure `apps/api` is also running (see its README) — this app calls it directly via `fetch`, cross-origin, relying on the API's CORS allowlist (`ALLOWED_ORIGIN`) rather than a dev proxy.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-checks (`vue-tsc -b`) then builds to `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run typecheck` | `vue-tsc --noEmit` |

## Configuration

Config is a handful of Vite env vars, read at **build time** and exposed as `import.meta.env.*`.

| Var | Purpose | Example |
|---|---|---|
| `VITE_API_BASE` | Base URL of the `apps/api` Worker — no trailing slash, no `/api` suffix (that's added per-call). | `http://localhost:8787` (dev) / `https://secretshare-api.<you>.workers.dev` or a custom domain (prod) |
| `VITE_TURNSTILE_ENABLED` | `"true"`/`"false"`. Mounts the Turnstile widget on both the create form and the reveal form, blocking submit until it's solved. Must match the API's `TURNSTILE_ENABLED` — the backend re-verifies independently regardless, but a mismatch means either an unnecessary widget or requests the API will reject. | `false` |
| `VITE_TURNSTILE_SITE_KEY` | The Turnstile **site key** (public, safe to ship in client JS) for your Cloudflare Turnstile widget. Only read when `VITE_TURNSTILE_ENABLED` is `true`. | `0x4AAAAAAA...` |

Copy `.env.example` to `.env.local` for local dev. On Cloudflare, these are set as **build-time environment variables** in the Workers project settings (see [`../../DEPLOYMENT.md`](../../DEPLOYMENT.md)) — Vite bakes them into the built JS, so they must be set before the build runs, not read at request time.

## Routes

| Path | View | Purpose |
|---|---|---|
| `/` | `CreateSecret.vue` | Compose a secret, pick max views / expiry, encrypt client-side, submit, get a share link |
| `/s/:id` | `RevealSecret.vue` | Probe a secret's status, then explicitly reveal + decrypt it client-side |

Routing uses `vue-router`'s `createWebHistory` (**not** hash mode) — the share link's `#{key}` fragment *is* the encryption key, not a router hash-route, so the router must leave `location.hash` alone. This requires the hosting platform to serve `index.html` for unknown paths (e.g. a direct load of `/s/abc123`), configured via `wrangler.toml`'s `[assets]` block:
```toml
[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```
`not_found_handling = "single-page-application"` serves `index.html` only when a request doesn't match a real file in `directory` — real asset requests (`/assets/*.js`, etc.) are still served directly. This replaced an earlier `public/_redirects`-based approach (`/*  /index.html  200` or `/*  /  200`): on Workers Static Assets, `_redirects` rules are unconditional ("always followed, regardless of whether or not an asset matches the incoming request" per Cloudflare's docs), so a broad SPA-fallback rule there ends up redirecting real asset requests too, breaking the app. `index.html` still sets `<base href="/" />` from that earlier attempt — harmless, left in place.

## How the crypto flow works

`src/lib/crypto.ts` — AES-256-GCM via WebCrypto, in two key-derivation flavors:

**Common to both modes**
- The secret's id is generated **in the browser, before encryption** (`generateSecretId()`, 16 random bytes → 22 base64url chars) and passed to AES-GCM as **additional authenticated data (AAD)**. Decryption only succeeds when the ciphertext is presented under the same id it was created with, so the server can't swap ciphertexts between records undetected.
- The envelope sent to (and stored verbatim by) the API is `v1:ivBase64:ciphertextBase64` — the `v1` version tag gives future format changes (e.g. a different KDF or AEAD) a migration path. `decryptData()` rejects anything that isn't exactly three `:`-separated parts with a `v1` tag and a 12-byte IV.

**Random-key mode**
- **Create**: generate a random 256-bit key → encrypt the secret text with a fresh random 12-byte IV (id as AAD) → build the `v1:` envelope → export the key as 43 base64url characters → append to the share URL as a fragment: `https://<host>/s/{id}#{key}`.
- **Reveal**: read the id from the route, read the key from `window.location.hash` (deliberately not via vue-router; validated as exactly 43 base64url chars decoding to 32 bytes up front, so a mangled link fails before a view is spent), probe the secret (does not consume a view), then on explicit user action call reveal (consumes a view) and decrypt the returned envelope with the imported key and the id as AAD.
- The key never appears in any HTTP request body, query string, or path — only in the fragment, which browsers never transmit.

**Password mode**
- **Create**: generate a random 16-byte salt → one **single-block** PBKDF2-HMAC-SHA-256 run at `PBKDF2_ITERATIONS` (600,000) producing a 256-bit master secret (`deriveKeyAndVerifier()`) — single-block matters: PBKDF2 charges the full iteration count *per 32-byte output block*, so asking for 512 bits would double the client's cost while an attacker cracking the verifier still pays for only one block. The master is then expanded with HKDF-SHA256 (two HMACs — free next to the PBKDF2) into the AES-GCM encryption key (info label `secretshare:v1:enc`, imported non-extractable) and the **verifier** (info label `secretshare:v1:verify`) — a value the server can check a password against without it being invertible into the actual encryption key, with domain separation explicit in the labels. Encrypt as above. The share link is just `https://<host>/s/{id}` (no fragment — there's no key to embed). The salt, iteration count, and verifier are sent to the API as `kdf: { salt, iterations, verifier }` and stored server-side; none of them are secret — they're just parameters the recipient needs to re-derive the same key/verifier from the password. The creator/recipient pays exactly the same PBKDF2 cost an offline attacker pays per guess. `CreateSecret.vue` also offers a "Suggest a password" button (`generateSecurePassword()`, CSPRNG-based) for users who don't want to pick their own.
- **Reveal**: `GET /api/secrets/:id` reports `requiresPassword: true` plus the (non-secret) `kdf.salt`/`kdf.iterations`. The client refuses server-supplied iteration counts outside `MIN_PBKDF2_ITERATIONS`–`MAX_PBKDF2_ITERATIONS` (100,000–2,000,000) — a compromised server shouldn't be able to request a trivially weak derivation or a browser-freezing one. Clicking reveal runs `deriveKeyAndVerifier()` **once**, sends the verifier half to `POST /:id/verify-password` — **this does not consume a view** — and keeps the key half. A wrong password shows an inline error and lets the user retry (bounded server-side by `FAILED_ATTEMPTS_CAP`, see [`apps/api/README.md`](../api/README.md)); only once verification succeeds does the app call `POST /:id/reveal` (now consuming the view) and decrypt with the already-derived key. One PBKDF2 run per attempt, total.
- The password itself is never sent to the server in any form — only the (non-secret) salt, iteration count, and verifier travel over the wire, and the verifier alone can't be turned back into the encryption key.

## `src/lib/api.ts`

Thin typed wrapper around the API endpoints (`createSecret`, `probeSecret`, `verifyPassword`, `revealSecret`, `deleteSecret`), matching `apps/api`'s contract exactly — see [`apps/api/README.md`](../api/README.md#api-contract) for the full request/response shapes. Non-2xx responses throw `ApiError(status, message)`, except a 404 from `probeSecret`, which is a valid `{ exists: false }` result, not an error.

## Turnstile

`src/components/TurnstileWidget.vue` lazily loads Cloudflare's `turnstile/v0/api.js` script (once per page, even if the component is used more than once) and renders a widget for the given `site-key` prop, emitting `verified`/`expired`/`error` events. Both `CreateSecret.vue` and `RevealSecret.vue` only mount it when `VITE_TURNSTILE_ENABLED === "true"`, and disable their submit button until a token has been emitted.

`CreateSecret.vue` only ever needs one token per submission (a single API call), so it uses the token directly and resets the widget (`widget.reset()`) after any failed submission, since a token is single-use.

`RevealSecret.vue` is trickier: revealing a password-protected secret makes **two** protected calls back-to-back in the same click handler — `verify-password`, then `reveal` — and a spent token can't be resubmitted for the second call (Cloudflare's `siteverify` marks a token used on first check, so replaying it always fails). It solves this with a small token queue instead of a single ref: `consumeTurnstileToken()` grabs the currently-held token (if the widget has already solved one) and immediately calls `widget.reset()` to start solving a replacement in the background; if no token is ready yet (e.g. a fresh reset is still in flight), it returns a promise that resolves off the next `verified` event instead of reusing anything already spent. Both `verify-password` and `reveal` call `consumeTurnstileToken()` immediately before their request, guaranteeing they never share a token — including across a wrong-password retry, which goes through the same queue on the next attempt.

This is a **UX gate only** — the actual security boundary is the API's own `siteverify` call (see [`apps/api/README.md`](../api/README.md)), which always re-checks the token server-side regardless of what the frontend does.

## UI

Built with [PrimeVue](https://primevue.org/) (Aura theme preset) for form controls, buttons, and feedback components — no Tailwind or other CSS framework.

## Known gaps (planned follow-up passes)

- Any client-side rate-limit affordances (handled server-side/dashboard-side for now)
