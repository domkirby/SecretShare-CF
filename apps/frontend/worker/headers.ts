/**
 * The security response headers both the HTML and the static assets are served
 * with. Kept as a pure function so it can be unit-tested without a Worker
 * runtime — worker/index.ts is the only thing that knows about Request,
 * Response or the ASSETS binding.
 *
 * The policy is deliberately tight. A secret's decryption key lives in the URL
 * fragment and never leaves the browser (see CRYPTO.md), so any script that
 * runs on this origin can read it. The allowlist is therefore exactly three
 * things: this origin, Cloudflare Turnstile, and the API origin — which is a
 * separate host, since the API and the frontend are two separate Workers
 * (`shareapi.example.com` alongside `share.example.com`, or two different
 * *.workers.dev names).
 */

/** Cloudflare Turnstile serves both its script and its challenge iframe here. */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export interface SecurityHeaderOptions {
  /** Origin the page is served from — `new URL(request.url).origin`. */
  pageOrigin: string;
  /**
   * Configured API base (the API_ORIGIN Worker var). Anything the URL parser
   * accepts is reduced to a bare origin, so a trailing slash or a path suffix
   * in the deployment's configured value cannot corrupt the directive; an
   * unparseable value is dropped rather than emitted.
   */
  apiOrigin?: string;
  /**
   * Per-response nonce, present only for HTML. PrimeVue's theme and Turnstile
   * both inject <style> elements at runtime, so style-src has to admit them
   * somehow; a nonce does that without opening the door to every inline style
   * an injection could add.
   */
  nonce?: string;
}

/**
 * Reduce a configured API base to the origin CSP wants, or undefined when it
 * is missing, unparseable, or the page's own origin (already covered by
 * 'self', and repeating it just makes the header noisier).
 */
export function normalizeApiOrigin(value: string | undefined, pageOrigin: string): string | undefined {
  if (!value) return undefined;
  let origin: string;
  try {
    origin = new URL(value).origin;
  } catch {
    return undefined;
  }
  // URL accepts things like "mailto:x" whose origin serializes to "null".
  if (origin === "null" || origin === pageOrigin) return undefined;
  return origin;
}

export function buildContentSecurityPolicy({ pageOrigin, apiOrigin, nonce }: SecurityHeaderOptions): string {
  const api = normalizeApiOrigin(apiOrigin, pageOrigin);

  const directives: Record<string, string[]> = {
    "default-src": ["'none'"],
    // The app's own bundle, plus the Turnstile widget. Vite emits external
    // module scripts and zxcvbn's dynamic import() chunks are same-origin, so
    // no inline script is ever needed.
    "script-src": ["'self'", TURNSTILE_ORIGIN],
    "style-src": nonce ? ["'self'", `'nonce-${nonce}'`] : ["'self'"],
    "img-src": ["'self'", "data:"],
    // primeicons ships its woff2 through the bundle, so it is same-origin.
    "font-src": ["'self'"],
    "connect-src": api ? ["'self'", api] : ["'self'"],
    "frame-src": [TURNSTILE_ORIGIN],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'none'"],
    "object-src": ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/**
 * The full header set. No Strict-Transport-Security: HSTS pins the whole
 * domain (and with includeSubDomains every sibling host of it), which is a
 * zone-level decision to make in Cloudflare, not something an app should
 * decide for the domain it happens to be deployed on.
 */
export function buildSecurityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  return {
    "Content-Security-Policy": buildContentSecurityPolicy(options),
    "X-Content-Type-Options": "nosniff",
    // Secret ids appear in the path of /s/:id. The key is in the fragment and
    // is never sent anywhere, but the id should not leak to third parties via
    // an outbound referer either.
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
