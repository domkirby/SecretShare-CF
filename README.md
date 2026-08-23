# SecretShare-CF

A zero-knowledge, self-destructing secret sharing tool, built natively for Cloudflare. This is a from-scratch rewrite of [domkirby/SecretShare](https://github.com/domkirby/SecretShare) (originally PHP/MySQL) targeting Cloudflare Workers + D1 instead.

The server never sees plaintext, and in random-key mode it never sees the encryption key either — encryption/decryption happen entirely in the browser via WebCrypto, and the key is passed around as a URL fragment (`#...`), which browsers never send over the network.

## Architecture

Two independently deployable pieces:

| Component | Tech | Where it lives | Docs |
|---|---|---|---|
| **Frontend** | Vue 3 + Vite (SPA) | Cloudflare Workers (static assets) | [`apps/frontend/README.md`](apps/frontend/README.md) |
| **API** | Hono (TypeScript) on Workers + D1 | Cloudflare Workers | [`apps/api/README.md`](apps/api/README.md) |

They are deliberately **not** wired together as a single Worker — the API is a standalone Worker with its own domain/lifecycle, so it can be deployed, redeployed, or moved to a different hostname without touching the frontend. The frontend just needs to know the API's base URL (`VITE_API_BASE`).

```
apps/
├── frontend/   # Cloudflare Workers (static assets) — Vue 3 SPA
└── api/        # Cloudflare Worker — Hono + D1
```

Each app is a standalone npm package (not an npm workspace) — see each app's own README for setup, environment variables, and local development instructions.

## Crypto model (short version)

- **Random-key mode** (default): a random AES-256-GCM key is generated in the browser, used to encrypt the secret, then base64url-encoded (43 chars) and appended to the share link as a URL fragment (`https://.../s/{id}#{key}`). The fragment never leaves the browser — it's not sent in HTTP requests and isn't logged by servers or proxies.
- **Password mode**: a PBKDF2-HMAC-SHA-256 (600,000 iterations, one output block — so the user pays exactly the same per-guess cost an offline attacker pays) derivation from a password the recipient already knows out-of-band, then a cheap HKDF-SHA256 expansion of that master secret into two values under distinct labels: the AES-256-GCM key (never transmitted) and the "verifier" the server stores. The verifier lets the server confirm a password is correct *before* a view is consumed — so a typo doesn't burn the secret's one-time view — while remaining impossible to turn back into the encryption key. The salt and iteration count are not secret and are stored server-side; the client rejects server-supplied iteration counts outside 100,000–2,000,000.
- The server only ever stores/serves an opaque `v1:ivBase64:ciphertextBase64` envelope — it cannot decrypt it under either mode. The secret's ID is generated in the browser *before* encryption and bound into the ciphertext as AES-GCM additional authenticated data (AAD), so the server can't swap ciphertexts between records without decryption failing.

## Deploying

Pushing to `main` deploys both apps to Cloudflare Workers via GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

**Forking this to run your own copy needs no file edits.** Nothing deployment-specific is committed: each app's `wrangler.jsonc` is generated in CI from a committed `wrangler.jsonc.example` plus GitHub repository secrets and variables. Fork it, set those, push. Pulling upstream changes later never conflicts.

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the full list of secrets/variables, the Cloudflare API token scope, and D1 setup.

## Local development

Run both apps side by side:

```bash
# terminal 1
cd apps/api && npm install && cp wrangler.jsonc.example wrangler.jsonc \
  && npm run db:migrate:local && npm run dev                            # http://localhost:8787

# terminal 2
cd apps/frontend && npm install && cp .env.example .env.local && npm run dev   # http://localhost:5173
```

`apps/api/wrangler.jsonc` is gitignored — the committed `wrangler.jsonc.example` is the template, with a comment on each field. The placeholders are fine for local work.

See each app's README for full details, required environment variables, and available scripts.

## Tests

Every pull request runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml): the API's and frontend's unit tests, both typechecks, and a real frontend production build. The deploy workflow re-runs the tests before it deploys, so a red commit can't reach Cloudflare even on a direct push to `main`.

```bash
cd apps/api      && npm test    # timing-safe compare, verifier hashing
cd apps/frontend && npm test    # AES-GCM round-trip, AAD binding, envelope parsing, PBKDF2/HKDF derivation
node --test scripts/render-wrangler.test.mjs   # deploy config rendering (no install needed)
```

## Status

- ✅ Backend API: create / probe / reveal / delete, atomic view-consumption, cron-based expiry sweep
- ✅ Frontend: random-key and password (PBKDF2) mode create/reveal flows
- ✅ Turnstile (bot protection on creation and reveal, both sides)
- ⬜ Rate limiting
