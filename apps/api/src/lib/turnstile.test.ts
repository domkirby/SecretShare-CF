import { afterEach, describe, expect, test, vi } from "vitest";
import type { Env } from "../routes/secrets";
import { verifyTurnstile } from "./turnstile";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

afterEach(() => vi.unstubAllGlobals());

function env(overrides: Partial<Env> = {}): Env {
  return {
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SECRET_KEY: "secret-key",
    ...overrides,
  } as unknown as Env;
}

/**
 * Stubs global fetch with a spy that returns `body` as JSON with `status`, and
 * captures the single siteverify request so tests can assert what was sent.
 */
function stubSiteverify(reply: { status?: number; body?: unknown } = {}) {
  const calls: { url: string; method: string; body: URLSearchParams }[] = [];
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: new URLSearchParams(String(init?.body ?? "")),
    });
    const body = reply.body ?? { success: true };
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return { fetchSpy, calls };
}

describe("verifyTurnstile", () => {
  test("returns true without a network call when disabled", async () => {
    const { fetchSpy } = stubSiteverify();
    expect(await verifyTurnstile(env({ TURNSTILE_ENABLED: "false" }), undefined)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns false without a network call when enabled but no token", async () => {
    const { fetchSpy } = stubSiteverify();
    expect(await verifyTurnstile(env(), undefined)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns true and forwards secret/response/remoteip on success", async () => {
    const { fetchSpy, calls } = stubSiteverify({ body: { success: true } });
    expect(await verifyTurnstile(env(), "tok-123", "1.2.3.4")).toBe(true);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(calls[0].url).toBe(SITEVERIFY_URL);
    expect(calls[0].method).toBe("POST");
    const sent = calls[0].body;
    expect(sent.get("secret")).toBe("secret-key");
    expect(sent.get("response")).toBe("tok-123");
    expect(sent.get("remoteip")).toBe("1.2.3.4");
  });

  test("omits remoteip when not provided", async () => {
    const { calls } = stubSiteverify({ body: { success: true } });
    expect(await verifyTurnstile(env(), "tok-123")).toBe(true);
    expect(calls[0].body.has("remoteip")).toBe(false);
  });

  test("returns false when siteverify reports success: false", async () => {
    stubSiteverify({ body: { success: false, "error-codes": ["invalid-input-response"] } });
    expect(await verifyTurnstile(env(), "tok-123")).toBe(false);
  });

  test("returns false on a non-2xx siteverify response", async () => {
    stubSiteverify({ status: 500, body: "upstream error" });
    expect(await verifyTurnstile(env(), "tok-123")).toBe(false);
  });

  test("fails closed when the secret key is unset (enabled but misconfigured)", async () => {
    // The request still goes out with secret="" and siteverify rejects it — an
    // enabled-but-keyless Worker must not silently accept everything.
    const { calls } = stubSiteverify({ body: { success: false } });
    expect(await verifyTurnstile(env({ TURNSTILE_SECRET_KEY: undefined }), "tok-123")).toBe(false);
    expect(calls[0].body.get("secret")).toBe("");
  });

  test("requires success to be exactly true, not merely truthy", async () => {
    stubSiteverify({ body: { "error-codes": [] } });
    expect(await verifyTurnstile(env(), "tok-123")).toBe(false);
  });
});
