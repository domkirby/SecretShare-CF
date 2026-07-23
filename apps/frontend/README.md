# SecretShare Frontend (`apps/frontend`)

A Vue 3 + Vite SPA deployed as a Cloudflare Workers static-assets project. This is the browser-side half of the zero-knowledge model: all encryption and decryption happen here, in-browser, via WebCrypto. The server (`apps/api`) never sees plaintext, and never sees the key or password either.

This is a standalone npm package, deployed independently of `apps/api` — it only needs to know the API's base URL.

Supports both **random-key mode** and **password mode**, plus an optional Turnstile challenge on creation. Rate-limiting UI is a planned follow-up pass.

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
| `VITE_TURNSTILE_ENABLED` | `"true"`/`"false"`. Mounts the Turnstile widget on the create form and blocks submit until it's solved. Must match the API's `TURNSTILE_ENABLED` — the backend re-verifies independently regardless, but a mismatch means either an unnecessary widget or a create request the API will reject. | `false` |
| `VITE_TURNSTILE_SITE_KEY` | The Turnstile **site key** (public, safe to ship in client JS) for your Cloudflare Turnstile widget. Only read when `VITE_TURNSTILE_ENABLED` is `true`. | `0x4AAAAAAA...` |

Copy `.env.example` to `.env.local` for local dev. On Cloudflare, these are set as **build-time environment variables** in the Workers project settings (see [`../../DEPLOYMENT.md`](../../DEPLOYMENT.md)) — Vite bakes them into the built JS, so they must be set before the build runs, not read at request time.

## Routes

| Path | View | Purpose |
|---|---|---|
| `/` | `CreateSecret.vue` | Compose a secret, pick max views / expiry, encrypt client-side, submit, get a share link |
| `/s/:id` | `RevealSecret.vue` | Probe a secret's status, then explicitly reveal + decrypt it client-side |

Routing uses `vue-router`'s `createWebHistory` (**not** hash mode) — the share link's `#{keyHex}` fragment *is* the encryption key, not a router hash-route, so the router must leave `location.hash` alone. This requires the hosting platform to serve `index.html` for unknown paths (e.g. a direct load of `/s/abc123`), configured via `wrangler.toml`'s `[assets]` block:
```toml
[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```
`not_found_handling = "single-page-application"` serves `index.html` only when a request doesn't match a real file in `directory` — real asset requests (`/assets/*.js`, etc.) are still served directly. This replaced an earlier `public/_redirects`-based approach (`/*  /index.html  200` or `/*  /  200`): on Workers Static Assets, `_redirects` rules are unconditional ("always followed, regardless of whether or not an asset matches the incoming request" per Cloudflare's docs), so a broad SPA-fallback rule there ends up redirecting real asset requests too, breaking the app. `index.html` still sets `<base href="/" />` from that earlier attempt — harmless, left in place.

## How the crypto flow works

`src/lib/crypto.ts` — AES-256-GCM via WebCrypto, in two key-derivation flavors:

**Random-key mode**
- **Create**: generate a random 256-bit key → encrypt the secret text with a fresh random 12-byte IV → base64-encode IV and ciphertext, join as `ivBase64:ciphertextBase64` (this envelope is what's sent to the API) → export the key as 64 hex characters → append to the share URL as a fragment: `https://<host>/s/{id}#{keyHex}`.
- **Reveal**: read the id from the route, read the key hex from `window.location.hash` (deliberately not via vue-router), probe the secret (does not consume a view), then on explicit user action call reveal (consumes a view), split the returned envelope on `:`, base64-decode both halves, decrypt with the imported key.
- The key never appears in any HTTP request body, query string, or path — only in the fragment, which browsers never transmit.

**Password mode**
- **Create**: generate a random 16-byte salt → derive a 256-bit AES-GCM key from the user's password via PBKDF2-HMAC-SHA-256 at `PBKDF2_ITERATIONS` (350,000) → encrypt as above. Also derive a **verifier**: an independent PBKDF2 output from the same password/iterations but a different salt (`deriveVerifier()`, salt + `":verify"` suffix) — this is a value the server can check a password against without it being invertible into the actual encryption key. The share link is just `https://<host>/s/{id}` (no fragment — there's no key to embed). The salt, iteration count, and verifier are sent to the API as `kdf: { salt, iterations, verifier }` and stored server-side; none of them are secret — they're just parameters the recipient needs to re-derive the same key/verifier from the password. `CreateSecret.vue` also offers a "Suggest a password" button (`generateSecurePassword()`, CSPRNG-based) for users who don't want to pick their own.
- **Reveal**: `GET /api/secrets/:id` reports `requiresPassword: true` plus the (non-secret) `kdf.salt`/`kdf.iterations`. Clicking reveal first derives a verifier from the entered password and calls `POST /:id/verify-password` — **this does not consume a view**. A wrong password shows an inline error and lets the user retry (bounded server-side by `FAILED_ATTEMPTS_CAP`, see [`apps/api/README.md`](../api/README.md)); only once verification succeeds does the app call `POST /:id/reveal` (now consuming the view) and decrypt with the actual `encKey` derived the same way as at creation.
- The password itself is never sent to the server in any form — only the (non-secret) salt, iteration count, and verifier travel over the wire, and the verifier alone can't be turned back into the encryption key.

## `src/lib/api.ts`

Thin typed wrapper around the API endpoints (`createSecret`, `probeSecret`, `verifyPassword`, `revealSecret`, `deleteSecret`), matching `apps/api`'s contract exactly — see [`apps/api/README.md`](../api/README.md#api-contract) for the full request/response shapes. Non-2xx responses throw `ApiError(status, message)`, except a 404 from `probeSecret`, which is a valid `{ exists: false }` result, not an error.

## Turnstile

`src/components/TurnstileWidget.vue` lazily loads Cloudflare's `turnstile/v0/api.js` script (once per page, even if the component is used more than once) and renders a widget for the given `site-key` prop, emitting `verified`/`expired`/`error` events. `CreateSecret.vue` only mounts it when `VITE_TURNSTILE_ENABLED === "true"`, and disables the submit button until a token has been emitted; the token is sent as `turnstileToken` on create and reset (`widget.reset()`) after any failed submission, since a token is single-use.

This is a **UX gate only** — the actual security boundary is the API's own `siteverify` call (see [`apps/api/README.md`](../api/README.md)), which always re-checks the token server-side regardless of what the frontend does.

## UI

Built with [PrimeVue](https://primevue.org/) (Aura theme preset) for form controls, buttons, and feedback components — no Tailwind or other CSS framework.

## Known gaps (planned follow-up passes)

- Any client-side rate-limit affordances (handled server-side/dashboard-side for now)
