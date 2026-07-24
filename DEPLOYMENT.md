# Deployment (Cloudflare Dashboard, Git-Connected)

## Forking this repo

`apps/api/wrangler.toml` and `apps/frontend/wrangler.toml` in this repo hold the *original* deployment's own live config (domain, D1 database ID) — not placeholders. That's a consequence of how Cloudflare's Git-connected Workers Builds work: it reads bindings and `[vars]` straight from whatever `wrangler.toml` is committed on the branch it builds, so these files have to stay committed and correct for the original deployment to keep working on every push.

If you're forking this to run your own copy, **before** connecting your fork to a new Cloudflare project:

1. Copy `apps/api/wrangler.toml.example` over `apps/api/wrangler.toml`, and `apps/frontend/wrangler.toml.example` over `apps/frontend/wrangler.toml`, in your fork.
2. Fill in the placeholder values as you go through the steps below (your own `database_id`, your own domain(s), etc).
3. Commit that to your fork before connecting it to Cloudflare — otherwise your first deploy will point at the original's D1 database and domain.

If you later want to pull upstream improvements into your fork, expect `wrangler.toml` to show a merge conflict — that's normal, since it's expected to diverge per-deployment; just keep your own values when resolving it.

This describes a **pull** deployment: you connect this GitHub repo to Cloudflare once, and Cloudflare builds and deploys both apps whenever you push — no local `wrangler deploy` and no CI pipeline of your own required. Each app is connected as its own Cloudflare project, since they deploy independently (see the root [`README.md`](README.md)).

You'll set up two things in the Cloudflare dashboard, both as **Workers** projects (via Cloudflare's Git-connected Workers Builds) — `apps/frontend` is a Workers *static-assets* project (no server-side Worker code, just `[assets]`-served files with SPA fallback), while `apps/api` is a regular code Worker:

1. `apps/api`
2. `apps/frontend`

Do the API first — the frontend needs its deployed URL for `VITE_API_BASE`.

## Prerequisites

- This repo pushed to GitHub (or GitLab), with Cloudflare granted access to it.
- A Cloudflare account with Workers + D1 available (all on the free tier for this project's scale).

---

## 1. Deploy the API (`apps/api`) as a Worker

### 1.1 Create the D1 database

Do this first so you have a real `database_id` before the first deploy.

1. Cloudflare dashboard → **Storage & Databases → D1 SQL Database** → **Create**.
2. Name it (e.g. `secretshare-prod`) and create it.
3. Open the new database → **Console** tab → paste in the contents of [`apps/api/schema.sql`](apps/api/schema.sql) and run it. This creates the `secrets` table and its index.
4. Copy the database's **Database ID** (shown on its overview page).

### 1.2 Update `wrangler.toml` with the real database ID

In [`apps/api/wrangler.toml`](apps/api/wrangler.toml), replace the placeholder `database_id` under `[[d1_databases]]` with the ID from step 1.1, and set `database_name` to match what you created. Commit and push this change — Cloudflare's Git-connected Workers deploys read bindings straight from `wrangler.toml` in the repo, so this file is the source of truth for the D1 binding.

Also review the other `[vars]` in that file before your first deploy — in particular set `ALLOWED_ORIGIN` to include the production frontend domain you'll get in step 2 (you can come back and add it after step 2, then push again; see step 1.6).

### 1.3 Create the Worker project

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Workers** → **Import a repository** (this flow is Cloudflare's Git-connected "Workers Builds").
2. Select this repo and branch (e.g. `main`).
3. Set the **root directory** to `apps/api` — this is a monorepo, so Cloudflare needs to know which subfolder to build from.
4. Build settings: Cloudflare auto-detects `wrangler.toml` and uses `wrangler deploy` as the deploy command. No custom build command is needed (there's no compile step — Wrangler bundles the Worker itself). If prompted for a build command, leave it empty/default.

### 1.4 (Optional) Turnstile bot protection

Skip this if you're not enabling Turnstile — `TURNSTILE_ENABLED` defaults to `"false"` in `wrangler.toml`, which makes `POST /api/secrets`, `POST /:id/verify-password`, and `POST /:id/reveal` all accept requests with no token at all.

To enable it:

1. Cloudflare dashboard → **Turnstile** → **Add a site**. Register the domain(s) your frontend will be served from (its `workers.dev` domain and/or custom domain) and note the **Site Key** and **Secret Key** it gives you.
2. In `apps/api/wrangler.toml`, set `TURNSTILE_ENABLED = "true"` and push.
3. Worker project → **Settings → Variables and Secrets** → add `TURNSTILE_SECRET_KEY` as a **Secret** (encrypted) with the Secret Key from step 1 — never put this in `wrangler.toml`.
4. When you set up the frontend project in step 2, set `VITE_TURNSTILE_ENABLED=true` and `VITE_TURNSTILE_SITE_KEY=<your Site Key>` there.

Plain `[vars]` (`ALLOWED_ORIGIN`, `TURNSTILE_ENABLED`, `MAX_SECRET_BYTES`, etc.) don't need to be set in the dashboard — they come from `wrangler.toml` in the repo. Only add dashboard variables if you need an override that differs from what's committed (e.g. a per-environment value you don't want in git).

### 1.5 First deploy

Trigger the deploy (either it runs automatically after import, or push a commit). Confirm:

- The Worker's URL (e.g. `https://secretshare-api.<your-subdomain>.workers.dev`) responds at `/health` with `{"ok":true}`.
- The cron trigger is active: Worker project → **Triggers** tab should show the schedule from `wrangler.toml`'s `[triggers]` block (`*/5 * * * *`).

### 1.6 (Optional) Custom domain

Worker project → **Settings → Domains & Routes** → add a custom domain (e.g. `shareapi.example.com`) if you don't want the default `workers.dev` URL. Whichever domain you end up using is what the frontend's `VITE_API_BASE` will point to.

Once you know your final frontend domain (next section), come back to `apps/api/wrangler.toml`, update `ALLOWED_ORIGIN` to include it, and push — Cloudflare will redeploy automatically.

---

## 2. Deploy the frontend (`apps/frontend`) as a Workers static-assets project

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Workers** → **Import a repository**.
2. Select the same repo/branch.
3. Set the **root directory** to `apps/frontend`.
4. Build settings: **Build command**: `npm run build`. Cloudflare auto-detects [`apps/frontend/wrangler.toml`](apps/frontend/wrangler.toml), whose `[assets]` block (`directory = "./dist"`, `not_found_handling = "single-page-application"`) tells it to serve the built `dist/` folder as static assets, falling back to `index.html` for any request that doesn't match a real file — this is what makes direct loads of `/s/:id` links work, since the app uses `vue-router`'s history mode. There's no server-side Worker code for this app (no `main` in its `wrangler.toml`), so nothing else to configure here.
5. **Environment variables** (project → **Settings → Variables and Secrets**, set for both Production and Preview):
   - `VITE_API_BASE` = the API Worker's URL from step 1 (e.g. `https://secretshare-api.<your-subdomain>.workers.dev` or your custom domain). This is read at **build time** by Vite, so it must be set here before deploying, not adjustable after the fact without a rebuild.
   - If you enabled Turnstile in step 1.4: `VITE_TURNSTILE_ENABLED=true` and `VITE_TURNSTILE_SITE_KEY=<your Site Key>`. The site key is public (it's meant to ship in client JS), so it's fine as a plain variable, not a secret.
6. Deploy.
7. (Optional) **Settings → Domains & Routes** to attach your own domain instead of the default `*.workers.dev` one.

**Avoid `public/_redirects` for SPA fallback on this platform.** Workers Static Assets applies `_redirects` rules unconditionally — "always followed, regardless of whether or not an asset matches the incoming request" per Cloudflare's docs — so a broad SPA-fallback rule there (e.g. `/* /index.html 200`) ends up redirecting real asset requests (`/assets/*.js`) too, breaking the app. `not_found_handling = "single-page-application"` in `wrangler.toml` is the correct mechanism instead, since it only kicks in when no real asset matches.

### Closing the loop

If you set up a custom domain for the frontend after already deploying the API, go back to `apps/api/wrangler.toml`, add that domain to `ALLOWED_ORIGIN`, and push. Without this, the browser will get CORS errors calling the API from your production frontend domain.

---

## Updating either app

Because both are Git-connected, updates are just `git push` to the connected branch — each project rebuilds and redeploys independently. There is nothing else to run manually, and no reason to use `wrangler deploy` locally unless you want to deploy from your machine outside of git (not the workflow this document describes).

## Verifying a deployment

Same checks as local dev (see each app's README), just against the deployed URLs:

1. Open the frontend's Workers URL, create a secret, confirm a share link appears.
2. Open the share link (ideally in a private window) and reveal it — confirm the plaintext round-trips correctly.
3. Reload the same reveal link — confirm it now reports as expired/not-found (view consumed).
4. Check the Worker's **Logs** tab (Real-time Logs) if anything 500s, and confirm the D1 database is the real one from step 1.1, not left pointing at a placeholder ID.
