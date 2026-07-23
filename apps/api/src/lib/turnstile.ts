import type { Env } from "../routes/secrets";

/**
 * TODO: wire up real Cloudflare Turnstile verification.
 * - Requires TURNSTILE_SECRET_KEY via `wrangler secret put TURNSTILE_SECRET_KEY`
 *   (never in wrangler.toml).
 * - POST to https://challenges.cloudflare.com/turnstile/v0/siteverify with
 *   { secret, response: token, remoteip }.
 * - Gate on env.TURNSTILE_ENABLED === "true"; the frontend flag is never
 *   trusted alone, this check must be re-verified server-side.
 *
 * For now this always succeeds so create->reveal can be tested end-to-end
 * without a Turnstile widget.
 */
export async function verifyTurnstile(_env: Env, _token: string | undefined): Promise<boolean> {
  return true;
}
