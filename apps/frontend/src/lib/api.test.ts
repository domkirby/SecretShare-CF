import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, createSecret, deleteSecret, probeSecret, revealSecret } from "./api";

const BASE = "https://api.test.invalid";

afterEach(() => vi.unstubAllGlobals());

/**
 * Stubs global fetch with a spy that returns one canned Response and records
 * every call. `body` is JSON-stringified unless it's already a string; pass
 * `raw` to send a non-JSON body verbatim.
 */
const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  400: "Bad Request",
  401: "Unauthorized",
  404: "Not Found",
  500: "Internal Server Error",
};

function stubFetch(res: { status?: number; body?: unknown; raw?: string; statusText?: string }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const spy = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const status = res.status ?? 200;
    // A hand-built Response doesn't fill statusText from the code; a real
    // server would, and api.ts falls back to it, so emulate that here.
    const statusText = res.statusText ?? STATUS_TEXT[status] ?? "";
    if (status === 204) return new Response(null, { status, statusText });
    const payload = res.raw ?? (typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? {}));
    return new Response(payload, {
      status,
      statusText,
      headers: { "Content-Type": res.raw ? "text/html" : "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return { spy, calls };
}

function bodyOf(calls: { init?: RequestInit }[], i = 0): unknown {
  return JSON.parse(String(calls[i].init?.body));
}

describe("createSecret", () => {
  const req = { id: "x".repeat(22), ciphertext: "v1:iv:ct", maxViews: 1 };

  test("posts the request shape and returns the parsed response", async () => {
    const { calls } = stubFetch({ status: 201, body: { id: req.id, expiresAt: "2030-01-01T00:00:00Z" } });
    const out = await createSecret(req);

    expect(out).toEqual({ id: req.id, expiresAt: "2030-01-01T00:00:00Z" });
    expect(calls[0].url).toBe(`${BASE}/api/secrets`);
    expect(calls[0].init?.method).toBe("POST");
    expect(new Headers(calls[0].init?.headers).get("Content-Type")).toBe("application/json");
    expect(bodyOf(calls)).toEqual(req);
  });

  test("maps a non-2xx JSON error to ApiError(status, body.error)", async () => {
    stubFetch({ status: 400, body: { error: "id must be 22 base64url characters" } });
    await expect(createSecret(req)).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "id must be 22 base64url characters",
    });
    await expect(createSecret(req)).rejects.toBeInstanceOf(Error);
  });

  test("falls back to statusText when the error body is not JSON", async () => {
    stubFetch({ status: 500, raw: "<html>nope</html>" });
    await expect(createSecret(req)).rejects.toMatchObject({ status: 500, message: "Internal Server Error" });
  });

  test("falls back to statusText when the JSON body has no string error", async () => {
    stubFetch({ status: 400, body: { error: 123 } });
    await expect(createSecret(req)).rejects.toMatchObject({ status: 400, message: "Bad Request" });
  });
});

describe("probeSecret", () => {
  test("returns { exists: false } on 404 without throwing", async () => {
    stubFetch({ status: 404, body: { exists: false } });
    await expect(probeSecret("abc")).resolves.toEqual({ exists: false });
  });

  test("returns the parsed body on 200", async () => {
    const probe = { exists: true, requiresPassword: false, viewsRemaining: 1, expiresAt: "2030-01-01T00:00:00Z" };
    stubFetch({ status: 200, body: probe });
    await expect(probeSecret("abc")).resolves.toEqual(probe);
  });

  test("URL-encodes the id", async () => {
    const { calls } = stubFetch({ status: 200, body: { exists: true } });
    await probeSecret("a/b?c");
    expect(calls[0].url).toBe(`${BASE}/api/secrets/${encodeURIComponent("a/b?c")}`);
  });

  test("throws ApiError on a non-404 error", async () => {
    stubFetch({ status: 500, body: { error: "boom" } });
    await expect(probeSecret("abc")).rejects.toMatchObject({ status: 500, message: "boom" });
  });
});

describe("revealSecret", () => {
  test("sends an all-undefined body when no opts are given", async () => {
    const { calls } = stubFetch({ status: 200, body: { ciphertext: "v1:iv:ct" } });
    await expect(revealSecret("abc")).resolves.toEqual({ ciphertext: "v1:iv:ct" });
    expect(calls[0].url).toBe(`${BASE}/api/secrets/abc/reveal`);
    expect(bodyOf(calls)).toEqual({}); // JSON drops undefined values
  });

  test("forwards verifier and turnstileToken when provided", async () => {
    const { calls } = stubFetch({ status: 200, body: { ciphertext: "c" } });
    await revealSecret("abc", { verifier: "v", turnstileToken: "t" });
    expect(bodyOf(calls)).toEqual({ verifier: "v", turnstileToken: "t" });
  });

  test("maps a 401 to ApiError", async () => {
    stubFetch({ status: 401, body: { error: "invalid password" } });
    await expect(revealSecret("abc", { verifier: "v" })).rejects.toMatchObject({
      status: 401,
      message: "invalid password",
    });
  });

  test("does NOT special-case 404 the way probeSecret does", async () => {
    stubFetch({ status: 404, body: { error: "not found" } });
    await expect(revealSecret("abc")).rejects.toMatchObject({ status: 404, message: "not found" });
  });
});

describe("deleteSecret", () => {
  test("resolves undefined on 204 without reading a body", async () => {
    const { calls } = stubFetch({ status: 204 });
    await expect(deleteSecret("abc")).resolves.toBeUndefined();
    expect(calls[0].url).toBe(`${BASE}/api/secrets/abc`);
    expect(calls[0].init?.method).toBe("DELETE");
  });

  test("throws ApiError on failure", async () => {
    stubFetch({ status: 500, body: { error: "kaboom" } });
    await expect(deleteSecret("abc")).rejects.toMatchObject({ status: 500, message: "kaboom" });
  });

  test("URL-encodes the id", async () => {
    const { calls } = stubFetch({ status: 204 });
    await deleteSecret("a b");
    expect(calls[0].url).toBe(`${BASE}/api/secrets/${encodeURIComponent("a b")}`);
  });
});

describe("ApiError", () => {
  test("carries status and message and is an Error", () => {
    const err = new ApiError(418, "teapot");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(418);
    expect(err.message).toBe("teapot");
    expect(err.name).toBe("ApiError");
  });
});
