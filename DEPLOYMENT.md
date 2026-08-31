# Deployment (GitHub Actions → Cloudflare Workers)

Pushing to `main` deploys both apps to Cloudflare via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Nothing deployment-specific is committed to this repo: each app's `wrangler.jsonc` is **generated at deploy time** from a committed `wrangler.jsonc.example` plus GitHub secrets and variables.

That means a fork needs **zero file edits**. Set the secrets/variables listed below, push, done — and pulling upstream changes never conflicts, because the files that differ per-deployment aren't in git.

## How it works

```
apps/<app>/wrangler.jsonc.example   committed template, placeholder values
              +
GitHub secrets & variables          your deployment's real values
              ↓  scripts/render-wrangler.mjs
apps/<app>/wrangler.jsonc           gitignored, written in the CI runner
              ↓  cloudflare/wrangler-action
        deployed Worker
```

[`scripts/render-wrangler.mjs`](scripts/render-wrangler.mjs) parses the example as JSONC and assigns a fixed, explicit list of keys from a fixed list of environment variables — no templating language, no text substitution. Every field it can touch is listed in the `FIELDS` table at the top of that file; anything else passes through from the example untouched. Run with `--require-all` (as CI does), it fails the build if a required value is missing rather than deploying against a placeholder.

The two apps deploy independently and are path-filtered: a commit touching only `apps/frontend/` will not redeploy the API. Changes to the render script or the workflow itself redeploy both. The frontend job runs after the API job (the API's URL is baked into the frontend bundle at build time), but still runs when the API job was skipped.

---

## Forking this repo

1. **Fork it.** Don't edit any `wrangler.jsonc.example` — you won't need to.
2. **Create a Cloudflare API token** (below).
3. **Create your D1 database** (below) — this is the one step that has to happen before the first deploy.
4. **Set the GitHub secrets and variables** (below).
5. **Push to `main`.** The workflow deploys the API, applies D1 migrations, then builds and deploys the frontend.
6. **Close the loop on CORS**: once you know your frontend's final URL, set the `ALLOWED_ORIGIN` variable to it and push again (or re-run the workflow). Likewise set `VITE_API_BASE` to the API Worker's URL. On a first-ever deploy you don't know these URLs yet — see [First deploy, chicken-and-egg](#first-deploy-chicken-and-egg).

To pull in upstream improvements later, just merge or rebase. There is nothing per-deployment in the tree to conflict.

---

## 1. Cloudflare API token

Cloudflare dashboard → **My Profile → API Tokens → Create Token → Create Custom Token**.

Permissions:

| Type | Resource | Level |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | D1 | Edit |
| Account | Account Settings | Read |

Scope it to the account you're deploying into. Copy the token — this is the `CLOUDFLARE_API_TOKEN` secret.

Your **Account ID** is on the right-hand side of any Workers page in the dashboard (or under Workers & Pages → Overview). That's the `CLOUDFLARE_ACCOUNT_ID` secret.

## 2. Create the D1 database

The workflow applies migrations to a database, but it doesn't create one. Do this once, either way:

```bash
cd apps/api
npm install
npx wrangler d1 create secretshare-db     # or `npm run db:create`
```

or via the dashboard: **Storage & Databases → D1 SQL Database → Create**.

Note the **name** and the **Database ID** it prints. Those become the `D1_DATABASE_NAME` and `D1_DATABASE_ID` repository variables.

**You do not need to apply the schema by hand.** [`apps/api/migrations/`](apps/api/migrations) is a Wrangler D1 migrations directory, and the deploy workflow runs `wrangler d1 migrations apply DB --remote` before every API deploy. Wrangler records what it has applied in a `d1_migrations` table and skips those, so this is a no-op on every push after the first. Future schema changes are new numbered files in that directory — never edit an already-applied one.

> If you are pointing this at a database that already has a `secrets` table from before migrations existed, that's fine: `0001_create_secrets.sql` uses `CREATE TABLE IF NOT EXISTS`, so applying it records the migration without touching existing data.

## 3. (Optional) Turnstile

Skip this if you don't want bot protection — the default is off, and `POST /api/secrets` / `POST /:id/reveal` then accept requests with no token.

1. Cloudflare dashboard → **Turnstile → Add a site**. Register the domain(s) your frontend will be served from (its `workers.dev` domain and/or custom domain). Note the **Site Key** and **Secret Key**.
2. Set the variables `TURNSTILE_ENABLED=true`, `VITE_TURNSTILE_ENABLED=true`, and `VITE_TURNSTILE_SITE_KEY=<your Site Key>`, and the secret `TURNSTILE_SECRET_KEY=<your Secret Key>`.

The workflow pushes the secret key to the Worker with `wrangler secret put` on each deploy — it is never written into `wrangler.jsonc`. It only does this when `TURNSTILE_ENABLED` is `true`, so you can leave the secret unset while Turnstile is off.

The site key is public by design (it ships in client JS), which is why it's a variable rather than a secret. `TURNSTILE_ENABLED` and `VITE_TURNSTILE_ENABLED` must agree — the API re-verifies tokens independently regardless, so a mismatch means either a pointless widget or requests the API rejects.

## 4. GitHub secrets and variables

Repository → **Settings → Secrets and variables → Actions**.

### Secrets (the `Secrets` tab)

| Secret | Required | Description |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | yes | API token from step 1. |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Cloudflare account ID the Workers and D1 database live in. |
| `TURNSTILE_SECRET_KEY` | only if Turnstile is on | Turnstile server-side `siteverify` key. Pushed to the Worker via `wrangler secret put`. |

### Variables (the `Variables` tab)

| Variable | Required | Description |
|---|---|---|
| `D1_DATABASE_NAME` | yes | Name of the D1 database from step 2, e.g. `secretshare-db`. |
| `D1_DATABASE_ID` | yes | UUID of the D1 database from step 2. Not a secret — it's inert hex without an API token or dashboard access — it just can't be committed, since it differs per deployment. |
| `ALLOWED_ORIGIN` | yes | Comma-separated CORS allowlist for the API. Must contain every origin the frontend is served from, e.g. `https://secret.example.com`. No trailing slash. |
| `VITE_API_BASE` | yes | Base URL of the deployed API Worker, e.g. `https://secretshare-api.<subdomain>.workers.dev` or your custom domain. No trailing slash, no `/api` suffix. Used twice: baked into the frontend bundle at build time, and passed to the frontend Worker as `API_ORIGIN` so its Content-Security-Policy allows the browser to reach that host. A split-horizon setup (`https://shareapi.example.com` serving the API next to `https://share.example.com` serving the app) needs nothing extra — one variable covers both. |
| `CF_WORKER_NAME_API` | no | Overrides the API Worker's name (default `secretshare-api`). Determines its `*.workers.dev` hostname. |
| `CF_WORKER_NAME_FRONTEND` | no | Overrides the frontend Worker's name (default `secretsharecf-frontend`). |
| `TURNSTILE_ENABLED` | no | `true`/`false` (default `false`). Gates Turnstile on the API, and gates whether the workflow pushes `TURNSTILE_SECRET_KEY`. |
| `VITE_TURNSTILE_ENABLED` | no | `true`/`false` (default `false`). Mounts the Turnstile widget in the frontend. Keep in sync with `TURNSTILE_ENABLED`. |
| `VITE_TURNSTILE_SITE_KEY` | no | Turnstile site key. Public — safe in client JS. |
| `MAX_SECRET_BYTES` | no | Max ciphertext size accepted on create (default `65536`). |
| `DEFAULT_TTL_MINUTES` | no | TTL when `ttlMinutes` is omitted (default `1440`). |
| `MAX_TTL_MINUTES` | no | Upper bound for `ttlMinutes` (default `10080`). |
| `MAX_VIEWS_CAP` | no | Upper bound for `maxViews` (default `10`). |
| `FAILED_ATTEMPTS_CAP` | no | Wrong-password guesses before a secret is burned (default `5`). |

Unset optional variables fall back to the values in each app's `wrangler.jsonc.example`, so you only need to set what you actually want to change. See [`apps/api/README.md`](apps/api/README.md#configuration) for what each tuning variable bounds.

### Checking your configuration before you merge

The `Deploy configuration` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and fails if any of the required settings above are missing, listing all of them at once. It also catches half-configured Turnstile — enabled without a secret key or a site key, or `TURNSTILE_ENABLED` and `VITE_TURNSTILE_ENABLED` disagreeing — and then renders both configs with your real values using the same script the deploy uses, so it fails for the same reasons a deploy would. This is what turns "the deploy broke after merging" into a red check on the PR.

It reads secrets only to test whether they are set: each is compared to `''` in the workflow expression, so the runner receives a boolean and no value is ever printed. Nothing in this job contacts Cloudflare.

Two things worth knowing:

- **It is skipped on pull requests from forks.** GitHub does not provide secrets to those runs, so the check would fail on secrets it was never given. If you've forked this repo, the check still runs on pull requests within your own fork, against your own secrets.
- **It doesn't verify the values are *correct*** — only that they're present and self-consistent. A valid-but-wrong `D1_DATABASE_ID` still passes here and fails at deploy.

Consider making it a required status check (Settings → Branches → branch protection) so a misconfigured merge is blocked rather than merely flagged.

## 5. First deploy, chicken-and-egg

`ALLOWED_ORIGIN` and `VITE_API_BASE` each refer to the *other* app's deployed URL, which you don't know until something has deployed once. Two ways through it:

- **Predict the URLs.** Workers get `https://<worker-name>.<your-subdomain>.workers.dev`, and your subdomain is shown under Workers & Pages → Overview. Set both variables up front from the names you chose and the first deploy is already correct.
- **Deploy twice.** Set them to anything (or set `VITE_API_BASE` and leave `ALLOWED_ORIGIN` at a placeholder), push, read the real URLs off the two Workers, correct the variables, then re-run the workflow from the **Actions** tab (**Deploy → Run workflow**, with *Deploy both apps* checked).

If you attach custom domains afterwards, update both variables to the custom domains and re-run the workflow — `VITE_API_BASE` in particular is compiled into the frontend bundle *and* becomes the frontend Worker's CSP `connect-src`, so changing it requires a rebuild and redeploy, not just a settings change. Leaving it stale shows up as blocked requests in the browser console rather than as a failed deploy.

## 6. Verifying a deployment

1. `GET https://<api-worker>/health` returns `{"ok":true}`.
2. API Worker → **Settings → Triggers** shows the cron schedule `*/5 * * * *` (the expiry sweep).
3. Open the frontend, create a secret, confirm a share link appears.
4. Open the share link (ideally in a private window) and reveal it — the plaintext should round-trip.
5. Reload the same reveal link — it should now report expired/not-found (view consumed).
6. If anything 500s, check the API Worker's **Logs** tab. A CORS error in the browser console means `ALLOWED_ORIGIN` doesn't list the frontend's origin; a *Content Security Policy* error mentioning `connect-src` means `VITE_API_BASE` doesn't match the API's real origin — fix the variable and re-run the workflow.
7. `curl -sI https://<frontend-worker>/` shows a `content-security-policy` header, and so does a request for one of the `/assets/*.js` files.

### A note on HSTS

Neither Worker sends `Strict-Transport-Security`. It applies to a whole hostname — and with `includeSubDomains`, to every sibling of it — which makes it a decision for the domain rather than for one app deployed on it. Turn it on per-zone under **SSL/TLS → Edge Certificates → HTTP Strict Transport Security** once you're confident every host on that domain is HTTPS-only.

---

## Local development

Local dev does not involve GitHub Actions or any of the secrets above.

### `apps/api`

```bash
cd apps/api
npm install
cp wrangler.jsonc.example wrangler.jsonc   # gitignored; safe to edit freely
npm run db:migrate:local                   # applies migrations/ to local D1
npm run dev                                # http://localhost:8787
```

`wrangler.jsonc.example` has a comment on every field explaining what it's for. For purely local work you can leave the placeholders alone — local D1 is a SQLite file under `.wrangler/state/` keyed by the `DB` binding, so the placeholder `database_id` is never dereferenced. Fill in a real `database_name`/`database_id` only if you want to talk to remote D1 or deploy from your machine.

For Turnstile locally, put `TURNSTILE_ENABLED=true` and `TURNSTILE_SECRET_KEY=...` in a gitignored `.dev.vars` file rather than in `wrangler.jsonc`. Cloudflare publishes [Turnstile testing keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) that always pass or always fail.

### `apps/frontend`

```bash
cd apps/frontend
npm install
cp .env.example .env.local                 # set VITE_API_BASE if not localhost:8787
npm run dev                                # http://localhost:5173
```

You don't need a `wrangler.jsonc` here — `npm run dev` runs Vite, not Wrangler. Copy `wrangler.jsonc.example` to `wrangler.jsonc` only if you want to preview the built `dist/` through Wrangler or deploy by hand.

Make sure the API's `ALLOWED_ORIGIN` includes `http://localhost:5173` (the example's default does) — the frontend calls the API cross-origin, with no dev proxy.

### Deploying from your machine

Not normally necessary, but with a filled-in `wrangler.jsonc` and `npx wrangler login`:

```bash
cd apps/api && npm run db:migrate:remote && npm run deploy
cd ../frontend && npm run build && npx wrangler deploy
```

---

## Notes

**Avoid `public/_redirects` for SPA fallback.** Workers Static Assets applies `_redirects` rules unconditionally — "always followed, regardless of whether or not an asset matches the incoming request" per Cloudflare's docs — so a broad rule like `/* /index.html 200` also redirects real asset requests (`/assets/*.js`) and breaks the app. `"not_found_handling": "single-page-application"` in the frontend's `wrangler.jsonc` is the correct mechanism: it only applies when no real asset matches.

**Rate limiting** is not implemented in-Worker. Until it is, use Cloudflare dashboard Rate Limiting Rules on `POST /api/secrets` and especially `POST /api/secrets/:id/reveal`.

**Don't also connect this repo to Cloudflare's Git-connected Workers Builds.** This repo used to deploy that way, which is why `wrangler.toml` had to be committed with real values. Running both at once means two deploy paths racing on the same Workers, and the dashboard-side build would fail anyway now that no `wrangler.jsonc` is committed. If a Git integration is still connected in the Cloudflare dashboard, disconnect it.
