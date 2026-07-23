# SecretShare-CF

A zero-knowledge, self-destructing secret sharing tool, built natively for Cloudflare. This is a from-scratch rewrite of [domkirby/SecretShare](https://github.com/domkirby/SecretShare) (originally PHP/MySQL) targeting Cloudflare Pages + Workers + D1 instead.

The server never sees plaintext, and in random-key mode it never sees the encryption key either — encryption/decryption happen entirely in the browser via WebCrypto, and the key is passed around as a URL fragment (`#...`), which browsers never send over the network.

## Architecture

Two independently deployable pieces:

| Component | Tech | Where it lives | Docs |
|---|---|---|---|
| **Frontend** | Vue 3 + Vite (SPA) | Cloudflare Pages | [`apps/frontend/README.md`](apps/frontend/README.md) |
| **API** | Hono (TypeScript) on Workers + D1 | Cloudflare Workers | [`apps/api/README.md`](apps/api/README.md) |

They are deliberately **not** wired together via Pages Functions — the API is a standalone Worker with its own domain/lifecycle, so it can be deployed, redeployed, or moved to a different hostname without touching the frontend. The frontend just needs to know the API's base URL (`VITE_API_BASE`).

```
apps/
├── frontend/   # Cloudflare Pages — Vue 3 SPA
└── api/        # Cloudflare Worker — Hono + D1
```

Each app is a standalone npm package (not an npm workspace) — see each app's own README for setup, environment variables, and local development instructions.

## Crypto model (short version)

- **Random-key mode** (default): a random AES-256-GCM key is generated in the browser, used to encrypt the secret, then hex-encoded and appended to the share link as a URL fragment (`https://.../s/{id}#{keyHex}`). The fragment never leaves the browser — it's not sent in HTTP requests and isn't logged by servers or proxies.
- **Password mode**: a PBKDF2-HMAC-SHA-256 (350,000 iterations) key derived from a password the recipient already knows out-of-band. The salt and iteration count are not secret and are stored server-side; the password itself is never transmitted. A second, independent PBKDF2 output (the "verifier," derived from the same password with a different salt) lets the server confirm a password is correct *before* a view is consumed — so a typo doesn't burn the secret's one-time view — while remaining impossible to turn back into the actual encryption key.
- The server only ever stores/serves an opaque `ivBase64:ciphertextBase64` envelope — it cannot decrypt it under either mode.

## Deploying

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for step-by-step instructions to deploy both apps from the Cloudflare dashboard (a "pull" deployment — Cloudflare pulls from your GitHub repo on push, no local `wrangler deploy`/CI required).

## Local development

Run both apps side by side:

```bash
# terminal 1
cd apps/api && npm install && npm run db:migrate:local && npm run dev   # http://localhost:8787

# terminal 2
cd apps/frontend && npm install && npm run dev                          # http://localhost:5173
```

See each app's README for full details, required environment variables, and available scripts.

## Status

- ✅ Backend API: create / probe / reveal / delete, atomic view-consumption, cron-based expiry sweep
- ✅ Frontend: random-key and password (PBKDF2) mode create/reveal flows
- ✅ Turnstile (bot protection on creation, both sides)
- ⬜ Rate limiting
