import { describe, expect, test } from "vitest";
import { buildContentSecurityPolicy, buildSecurityHeaders, normalizeApiOrigin } from "./headers";

const PAGE = "https://share.example.com";

/** Pull one directive's value out of a rendered policy. */
function directive(csp: string, name: string): string | undefined {
  return csp
    .split("; ")
    .find((part) => part === name || part.startsWith(`${name} `))
    ?.slice(name.length)
    .trim();
}

describe("normalizeApiOrigin", () => {
  test("reduces a configured base to a bare origin", () => {
    // VITE_API_BASE is documented as origin-only, but a trailing slash or a
    // stray path would otherwise land inside the CSP verbatim.
    expect(normalizeApiOrigin("https://shareapi.example.com", PAGE)).toBe("https://shareapi.example.com");
    expect(normalizeApiOrigin("https://shareapi.example.com/", PAGE)).toBe("https://shareapi.example.com");
    expect(normalizeApiOrigin("https://shareapi.example.com/api", PAGE)).toBe("https://shareapi.example.com");
    expect(normalizeApiOrigin("https://shareapi.example.com:8443/x?y=1", PAGE)).toBe(
      "https://shareapi.example.com:8443"
    );
  });

  test("drops a value that is unset, unparseable, or not a real origin", () => {
    for (const value of [undefined, "", "not a url", "/relative", "mailto:someone@example.com"]) {
      expect(normalizeApiOrigin(value, PAGE)).toBeUndefined();
    }
  });

  test("drops the page's own origin, which 'self' already covers", () => {
    expect(normalizeApiOrigin(PAGE, PAGE)).toBeUndefined();
    expect(normalizeApiOrigin(`${PAGE}/`, PAGE)).toBeUndefined();
  });
});

describe("buildContentSecurityPolicy", () => {
  test("allows the split-horizon API host to be reached, and nothing else", () => {
    const csp = buildContentSecurityPolicy({
      pageOrigin: PAGE,
      apiOrigin: "https://shareapi.example.com",
    });
    expect(directive(csp, "connect-src")).toBe("'self' https://shareapi.example.com");
  });

  test("falls back to same-origin when no API origin is configured", () => {
    expect(directive(buildContentSecurityPolicy({ pageOrigin: PAGE }), "connect-src")).toBe("'self'");
  });

  test("does not repeat the API origin when it is the page's own", () => {
    const csp = buildContentSecurityPolicy({ pageOrigin: PAGE, apiOrigin: PAGE });
    expect(directive(csp, "connect-src")).toBe("'self'");
  });

  test("allows Turnstile's script and its challenge iframe", () => {
    const csp = buildContentSecurityPolicy({ pageOrigin: PAGE });
    expect(directive(csp, "script-src")).toBe("'self' https://challenges.cloudflare.com");
    expect(directive(csp, "frame-src")).toBe("https://challenges.cloudflare.com");
  });

  test("admits runtime-injected styles by nonce only", () => {
    const withNonce = buildContentSecurityPolicy({ pageOrigin: PAGE, nonce: "abc123" });
    expect(directive(withNonce, "style-src")).toBe("'self' 'nonce-abc123'");

    // Non-HTML responses get no nonce, and must not get 'unsafe-inline' either.
    const withoutNonce = buildContentSecurityPolicy({ pageOrigin: PAGE });
    expect(directive(withoutNonce, "style-src")).toBe("'self'");
    expect(withNonce).not.toContain("unsafe-inline");
    expect(withoutNonce).not.toContain("unsafe-inline");
  });

  test("locks down everything that is not explicitly needed", () => {
    const csp = buildContentSecurityPolicy({ pageOrigin: PAGE, apiOrigin: "https://shareapi.example.com" });
    expect(directive(csp, "default-src")).toBe("'none'");
    expect(directive(csp, "object-src")).toBe("'none'");
    expect(directive(csp, "frame-ancestors")).toBe("'none'");
    expect(directive(csp, "form-action")).toBe("'none'");
    expect(directive(csp, "base-uri")).toBe("'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("*");
  });
});

describe("buildSecurityHeaders", () => {
  test("ships the companion hardening headers", () => {
    const headers = buildSecurityHeaders({ pageOrigin: PAGE });
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });

  test("leaves HSTS to the zone, on http and https alike", () => {
    // Pinning the apex (and, with includeSubDomains, its siblings) is a domain
    // decision, not this app's to make.
    for (const pageOrigin of [PAGE, "http://localhost:8788"]) {
      expect(buildSecurityHeaders({ pageOrigin })).not.toHaveProperty("Strict-Transport-Security");
    }
  });
});
