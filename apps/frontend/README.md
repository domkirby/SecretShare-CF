# SecretShare Frontend (`apps/frontend`)

A Vue 3 + Vite SPA for Cloudflare Pages. This is the browser-side half of the zero-knowledge model: all encryption and decryption happen here, in-browser, via WebCrypto. The server (`apps/api`) never sees plaintext or (in random-key mode) the key.

This is a standalone npm package, deployed independently of `apps/api` — it only needs to know the API's base URL.

Currently implements **random-key mode only**. Password (PBKDF2) mode, Turnstile, and rate-limiting UI are planned follow-up passes.

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

All config is a single Vite env var, read at build time and exposed as `import.meta.env.VITE_API_BASE`.

| Var | Purpose | Example |
|---|---|---|
| `VITE_API_BASE` | Base URL of the `apps/api` Worker — no trailing slash, no `/api` suffix (that's added per-call). | `http://localhost:8787` (dev) / `https://secretshare-api.<you>.workers.dev` or a custom domain (prod) |

Copy `.env.example` to `.env.local` for local dev. For Cloudflare Pages, this is set as a **build-time environment variable** in the Pages project settings (see [`../../DEPLOYMENT.md`](../../DEPLOYMENT.md)) — Vite bakes it into the built JS, so it must be set before the Pages build runs, not read at request time.

## Routes

| Path | View | Purpose |
|---|---|---|
| `/` | `CreateSecret.vue` | Compose a secret, pick max views / expiry, encrypt client-side, submit, get a share link |
| `/s/:id` | `RevealSecret.vue` | Probe a secret's status, then explicitly reveal + decrypt it client-side |

Routing uses `vue-router`'s `createWebHistory` (**not** hash mode) — the share link's `#{keyHex}` fragment *is* the encryption key, not a router hash-route, so the router must leave `location.hash` alone. This requires the hosting platform to serve `index.html` for unknown paths (e.g. a direct load of `/s/abc123`); Cloudflare Pages does this via `public/_redirects` (`/*  /index.html  200`), which is committed in this repo.

## How the crypto flow works

`src/lib/crypto.ts` — AES-256-GCM via WebCrypto:

- **Create**: generate a random 256-bit key → encrypt the secret text with a fresh random 12-byte IV → base64-encode IV and ciphertext, join as `ivBase64:ciphertextBase64` (this envelope is what's sent to the API) → export the key as 64 hex characters → append to the share URL as a fragment: `https://<host>/s/{id}#{keyHex}`.
- **Reveal**: read the id from the route, read the key hex from `window.location.hash` (deliberately not via vue-router), probe the secret (does not consume a view), then on explicit user action call reveal (consumes a view), split the returned envelope on `:`, base64-decode both halves, decrypt with the imported key.

The key never appears in any HTTP request body, query string, or path — only in the fragment, which browsers never transmit.

## `src/lib/api.ts`

Thin typed wrapper around the 4 API endpoints (`createSecret`, `probeSecret`, `revealSecret`, `deleteSecret`), matching `apps/api`'s contract exactly — see [`apps/api/README.md`](../api/README.md#api-contract) for the full request/response shapes. Non-2xx responses throw `ApiError(status, message)`, except a 404 from `probeSecret`, which is a valid `{ exists: false }` result, not an error.

## UI

Built with [PrimeVue](https://primevue.org/) (Aura theme preset) for form controls, buttons, and feedback components — no Tailwind or other CSS framework.

## Known gaps (planned follow-up passes)

- Password/PBKDF2 mode UI (the backend already accepts a `kdf` field; there's a `// TODO(pass 3)` marker in `RevealSecret.vue` where the password-entry branch will go)
- Turnstile widget on the create form
- Any client-side rate-limit affordances (handled server-side/dashboard-side for now)
