# SecretShare Frontend (`apps/frontend`)

A Vue 3 + Vite SPA deployed as a Cloudflare Workers static-assets project. This is the browser-side half of the zero-knowledge model: all encryption and decryption happen here, in-browser, via WebCrypto. The server (`apps/api`) never sees plaintext, and never sees the key or password either.

This is a standalone npm package, deployed independently of `apps/api` — it only needs to know the API's base URL.

Supports both **random-key mode** and **password mode**, plus an optional Turnstile challenge on both creation and reveal. Rate-limiting UI is a planned follow-up pass.

## Requirements

- Node.js 22+
- A running instance of `apps/api` (local `wrangler dev`, or a deployed Worker) to point at

## Setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` if your API isn't at the default local address.

You do not need a `wrangler.jsonc` for local development — `npm run dev` runs Vite, not Wrangler. Copy `wrangler.jsonc.example` to `wrangler.jsonc` (gitignored) only if you want to preview the built `dist/` through Wrangler or deploy by hand; CI renders its own from that same example.

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
| `npm test` | `vitest run` — unit tests for `src/lib/crypto.ts`, `src/lib/api.ts` and `worker/headers.ts` |
| `npm run preview` | Serves the production build locally |
| `npm run typecheck` | `vue-tsc --noEmit` for the app, then `tsc` for the `worker/` Worker (which needs the Workers globals, not the DOM ones) |

## Configuration

Config is a handful of Vite env vars, read at **build time** and exposed as `import.meta.env.*`.

| Var | Purpose | Example |
|---|---|---|
| `VITE_API_BASE` | Base URL of the `apps/api` Worker — no trailing slash, no `/api` suffix (that's added per-call). | `http://localhost:8787` (dev) / `https://secretshare-api.<you>.workers.dev` or a custom domain (prod) |
| `VITE_TURNSTILE_ENABLED` | `"true"`/`"false"`. Mounts the Turnstile widget on both the create form and the reveal form, blocking submit until it's solved. Must match the API's `TURNSTILE_ENABLED` — the backend re-verifies independently regardless, but a mismatch means either an unnecessary widget or requests the API will reject. | `false` |
| `VITE_TURNSTILE_SITE_KEY` | The Turnstile **site key** (public, safe to ship in client JS) for your Cloudflare Turnstile widget. Only read when `VITE_TURNSTILE_ENABLED` is `true`. | `0x4AAAAAAA...` |

One value is **not** a build var: `API_ORIGIN`, a runtime var on the Worker described below. It is rendered into `wrangler.jsonc` from the same `VITE_API_BASE`, so there is still only one thing to configure.

Copy `.env.example` to `.env.local` for local dev. For deploys, these are set as **GitHub repository variables** and passed to the build step by `.github/workflows/deploy.yml` (see [`../../DEPLOYMENT.md`](../../DEPLOYMENT.md)) — Vite bakes them into the built JS, so they must be set before the build runs, not read at request time.

## Routes

| Path | View | Purpose |
|---|---|---|
| `/` | `CreateSecret.vue` | Compose a secret, pick max views / expiry, encrypt client-side, submit, get a share link |
| `/s/:id` | `RevealSecret.vue` | Probe a secret's status, then explicitly reveal + decrypt it client-side |

Routing uses `vue-router`'s `createWebHistory` (**not** hash mode) — the share link's `#{key}` fragment *is* the encryption key, not a router hash-route, so the router must leave `location.hash` alone. This requires the hosting platform to serve `index.html` for unknown paths (e.g. a direct load of `/s/abc123`), configured via `wrangler.jsonc`'s `assets` block:
```jsonc
"assets": {
  "directory": "./dist",
  "not_found_handling": "single-page-application"
}
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
- **Create**: generate a random 16-byte salt → one **single-block** PBKDF2-HMAC-SHA-256 run at `PBKDF2_ITERATIONS` (600,000) producing a 256-bit master secret (`deriveKeyAndVerifier()`) — single-block matters: PBKDF2 charges the full iteration count *per 32-byte output block*, so asking for 512 bits would double the client's cost while an attacker cracking the verifier still pays for only one block. The master is then expanded with HKDF-SHA256 (two HMACs — free next to the PBKDF2) into the AES-GCM encryption key (info label `secretshare:v1:enc`, imported non-extractable) and the **verifier** (info label `secretshare:v1:verify`) — a value the server can check a password against without it being invertible into the actual encryption key, with domain separation explicit in the labels. The server additionally hashes the verifier before storing it (`HMAC-SHA256(salt, verifier)`, see [`apps/api/README.md`](../api/README.md#post-apisecretsidreveal)) — the client always sends the raw verifier, that hashing is server-side only. Encrypt as above. The share link is just `https://<host>/s/{id}` (no fragment — there's no key to embed). The salt, iteration count, and verifier are sent to the API as `kdf: { salt, iterations, verifier }`; none of them are secret — they're just parameters the recipient needs to re-derive the same key/verifier from the password. The creator/recipient pays exactly the same PBKDF2 cost an offline attacker pays per guess. Since the encryption key is derived straight from the password, `CreateSecret.vue` scores it live with `zxcvbn-ts` (`src/lib/passwordStrength.ts`, dictionary/pattern-aware, dynamically imported so its wordlists don't bloat the main bundle) and shows a persistent caution that a weak password means a weak key regardless of anything else in this scheme. It also offers a "Suggest a password" button (`generateSecurePassword()`, CSPRNG-based) for users who don't want to pick their own.
- **Reveal**: `GET /api/secrets/:id` reports `requiresPassword: true` plus the (non-secret) `kdf.salt`/`kdf.iterations`. The client refuses server-supplied iteration counts outside `MIN_PBKDF2_ITERATIONS`–`MAX_PBKDF2_ITERATIONS` (100,000–2,000,000) — a compromised server shouldn't be able to request a trivially weak derivation or a browser-freezing one. Clicking reveal runs `deriveKeyAndVerifier()` **once** and sends the verifier half straight to `POST /:id/reveal` along with the request that would otherwise just consume a view — there's no separate password-check call. The server validates the verifier before consuming a view, so a wrong password shows an inline error and lets the user retry for free (bounded server-side by `FAILED_ATTEMPTS_CAP`, see [`apps/api/README.md`](../api/README.md)); only a correct verifier both consumes the view and returns the ciphertext, which the client then decrypts with the key half it already derived. One PBKDF2 run and one API call per attempt, total.
- The password itself is never sent to the server in any form — only the (non-secret) salt, iteration count, and verifier travel over the wire, and the verifier alone can't be turned back into the encryption key.

## `src/lib/api.ts`

Thin typed wrapper around the API endpoints (`createSecret`, `probeSecret`, `revealSecret`, `deleteSecret`), matching `apps/api`'s contract exactly — see [`apps/api/README.md`](../api/README.md#api-contract) for the full request/response shapes. Non-2xx responses throw `ApiError(status, message)`, except a 404 from `probeSecret`, which is a valid `{ exists: false }` result, not an error. `revealSecret` takes an optional `{ verifier, turnstileToken }`, since password verification now happens as part of the same call.

## Turnstile

`src/components/TurnstileWidget.vue` lazily loads Cloudflare's `turnstile/v0/api.js` script (once per page, even if the component is used more than once) and renders a widget for the given `site-key` prop, emitting `verified`/`expired`/`error` events. Both `CreateSecret.vue` and `RevealSecret.vue` only mount it when `VITE_TURNSTILE_ENABLED === "true"`, and disable their submit button until a token has been emitted.

Both `CreateSecret.vue` and `RevealSecret.vue` only ever need one token per submission — creating a secret and revealing one (password-protected or not) are each a single API call now, so both views just hold the current token in a ref, use it directly on submit, and reset the widget (`widget.reset()`) after any failed attempt, since a token is single-use. There's no token queue: that only mattered back when revealing a password-protected secret meant two back-to-back protected calls (a separate password-check before reveal), which has since been merged into one.

This is a **UX gate only** — the actual security boundary is the API's own `siteverify` call (see [`apps/api/README.md`](../api/README.md)), which always re-checks the token server-side regardless of what the frontend does.

## Security headers

`dist/` is served by a small Worker (`worker/index.ts`) rather than by Workers Static Assets alone, for one reason: assets-only projects cannot set response headers, and this app needs a strict Content-Security-Policy. A secret's decryption key lives in the URL fragment and never leaves the browser, so any script that runs on this origin can read it — the CSP is what keeps that set to scripts we shipped.

`worker/headers.ts` builds the policy. It allows exactly three sources:

- **this origin** — the bundle, its CSS, the primeicons font, and zxcvbn's dynamically imported chunks;
- **`https://challenges.cloudflare.com`** — the Turnstile script (`script-src`) and its challenge iframe (`frame-src`);
- **`API_ORIGIN`** in `connect-src` — the API is a separate Worker on a different host (`shareapi.example.com` next to `share.example.com`, or two `*.workers.dev` names), so `'self'` alone would block every API call. The configured value is reduced to a bare origin, and dropped if it is unparseable or already this origin.

Everything else is `'none'`: no `unsafe-inline`, no `unsafe-eval`, no framing (`frame-ancestors 'none'`), no form posts. Alongside it the Worker sets `X-Content-Type-Options`, `Referrer-Policy: no-referrer` (secret ids appear in the path), `X-Frame-Options`, `Permissions-Policy`, and the two `Cross-Origin-*` headers. It does **not** set HSTS — that pins the whole domain and belongs in the zone's settings.

Two things follow from this that are easy to trip over:

- **Runtime-injected styles need the nonce.** `style-src` admits a per-response nonce and nothing else inline. The Worker injects `<meta name="csp-nonce">` into `<head>`; `src/lib/cspNonce.ts` reads it, `main.ts` hands it to PrimeVue (whose theme preset is injected as a `<style>` element), and `TurnstileWidget.vue` sets it on the Turnstile script tag, from which Turnstile copies it onto the styles it injects. Anything else that creates a `<style>` at runtime has to do the same.
- **`npm run dev` does not exercise any of this.** Vite serves `index.html` directly with no Worker in front of it, so there is no CSP and no nonce. To check the policy, build and serve through Wrangler: `npm run build && npx wrangler dev` (copy `wrangler.jsonc.example` to `wrangler.jsonc` first), then watch the browser console for violations.

## UI

Built with [PrimeVue](https://primevue.org/) (Aura theme preset) for form controls, buttons, and feedback components — no Tailwind or other CSS framework.

## Known gaps (planned follow-up passes)

- Any client-side rate-limit affordances (handled server-side/dashboard-side for now)
