import type { Env } from "../routes/secrets";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

/**
 * Always re-verified server-side, regardless of any frontend flag — a
 * modified or no-JS client can't skip verification just by omitting a
 * token when TURNSTILE_ENABLED is "true".
 */
export async function verifyTurnstile(
  env: Env,
  token: string | undefined,
  remoteIp?: string
): Promise<boolean> {
  if (env.TURNSTILE_ENABLED !== "true") return true;
  if (!token) return false;

  const body = new URLSearchParams();
  body.set("secret", env.TURNSTILE_SECRET_KEY ?? "");
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);

  const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
  if (!res.ok) return false;

  const data = (await res.json()) as SiteverifyResponse;
  return data.success === true;
}
