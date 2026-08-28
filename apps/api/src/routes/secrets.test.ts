import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";
import { hashVerifier } from "../lib/verifierHash";

// Matches the pool config in vitest.config.ts — asserted against, not guessed.
const CAPS = {
  MAX_SECRET_BYTES: 64,
  DEFAULT_TTL_MINUTES: 30,
  MAX_TTL_MINUTES: 120,
  MAX_VIEWS_CAP: 3,
  FAILED_ATTEMPTS_CAP: 2,
};

// Reused from verifierHash.test.ts so a derivation change surfaces in both.
const SALT = "AAECAwQFBgcICQoLDA0ODw==";
const VERIFIER = "EBESExQVFhcYGRobHB0eHw==";

const BASE = "https://test.example";

function freshId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function create(body: Record<string, unknown>) {
  return SELF.fetch(`${BASE}/api/secrets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function reveal(id: string, body: Record<string, unknown> = {}) {
  return SELF.fetch(`${BASE}/api/secrets/${id}/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const probe = (id: string) => SELF.fetch(`${BASE}/api/secrets/${id}`);
const del = (id: string) => SELF.fetch(`${BASE}/api/secrets/${id}`, { method: "DELETE" });

const rawBody = "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==";

/** Create a secret and return its id, failing loudly if create didn't 201. */
async function seed(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = freshId();
  const res = await create({ id, ciphertext: rawBody, maxViews: 1, ...overrides });
  expect(res.status).toBe(201);
  return id;
}

function dbRow(id: string) {
  return env.DB.prepare("SELECT * FROM secrets WHERE id = ?").bind(id).first<Record<string, unknown>>();
}

/** Like {@link dbRow} but fails the test if the row is gone. */
async function existingRow(id: string): Promise<Record<string, unknown>> {
  const r = await dbRow(id);
  expect(r, `expected secrets row ${id} to exist`).not.toBeNull();
  return r!;
}

beforeEach(async () => {
  // Belt-and-braces: the pool restores storage between tests, but a stray row
  // would be an unmissable failure rather than a silent one.
  await env.DB.prepare("DELETE FROM secrets").run();
});

describe("POST /api/secrets (create)", () => {
  test("stores a minimal secret and reports expiry at the default TTL", async () => {
    const id = freshId();
    const before = Date.now();
    const res = await create({ id, ciphertext: rawBody, maxViews: 1 });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string; expiresAt: string };
    expect(json.id).toBe(id);

    const skewMin = (new Date(json.expiresAt).getTime() - before) / 60_000;
    expect(skewMin).toBeGreaterThan(CAPS.DEFAULT_TTL_MINUTES - 2);
    expect(skewMin).toBeLessThan(CAPS.DEFAULT_TTL_MINUTES + 2);

    const row = await existingRow(id);
    expect(row).toMatchObject({ view_count: 0, burned: 0, kdf_salt: null });
  });

  test("rejects a malformed JSON body", async () => {
    const res = await SELF.fetch(`${BASE}/api/secrets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "Invalid JSON body" });
  });

  test.each([
    ["too short", "a".repeat(21)],
    ["too long", "a".repeat(23)],
    ["non-base64url chars", "a".repeat(21) + "$"],
  ])("rejects an id that is %s", async (_label, id) => {
    const res = await create({ id, ciphertext: rawBody, maxViews: 1 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/22 base64url/);
  });

  test("rejects a non-string id", async () => {
    const res = await create({ id: 123, ciphertext: rawBody, maxViews: 1 });
    expect(res.status).toBe(400);
  });

  test.each([[""], [undefined]])("rejects a missing/empty ciphertext (%p)", async (ciphertext) => {
    const res = await create({ id: freshId(), ciphertext, maxViews: 1 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/ciphertext is required/);
  });

  test("accepts a ciphertext exactly at the byte cap and rejects one byte over", async () => {
    const atCap = "x".repeat(CAPS.MAX_SECRET_BYTES);
    expect((await create({ id: freshId(), ciphertext: atCap, maxViews: 1 })).status).toBe(201);

    const overRes = await create({ id: freshId(), ciphertext: atCap + "x", maxViews: 1 });
    expect(overRes.status).toBe(413);
    expect(((await overRes.json()) as { error: string }).error).toContain(String(CAPS.MAX_SECRET_BYTES));
  });

  test("measures the cap in UTF-8 bytes, not characters", async () => {
    // 33 chars, but 3 bytes each in UTF-8 = 99 bytes > 64.
    const multibyte = "☂".repeat(33);
    expect(multibyte.length).toBeLessThan(CAPS.MAX_SECRET_BYTES);
    expect((await create({ id: freshId(), ciphertext: multibyte, maxViews: 1 })).status).toBe(413);
  });

  test.each([
    ["zero", 0],
    ["negative", -1],
    ["non-integer", 1.5],
    ["over the cap", CAPS.MAX_VIEWS_CAP + 1],
    ["a string", "1"],
  ])("rejects maxViews that is %s", async (_label, maxViews) => {
    const res = await create({ id: freshId(), ciphertext: rawBody, maxViews });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(`1 and ${CAPS.MAX_VIEWS_CAP}`);
  });

  test("accepts maxViews at the cap", async () => {
    expect(
      (await create({ id: freshId(), ciphertext: rawBody, maxViews: CAPS.MAX_VIEWS_CAP })).status
    ).toBe(201);
  });

  test.each([
    ["zero", 0],
    ["over the cap", CAPS.MAX_TTL_MINUTES + 1],
    ["non-integer", 1.5],
    ["a string", "x"],
  ])("rejects ttlMinutes that is %s", async (_label, ttlMinutes) => {
    const res = await create({ id: freshId(), ciphertext: rawBody, maxViews: 1, ttlMinutes });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(`1 and ${CAPS.MAX_TTL_MINUTES}`);
  });

  test("honours a ttlMinutes at the cap", async () => {
    const before = Date.now();
    const res = await create({
      id: freshId(),
      ciphertext: rawBody,
      maxViews: 1,
      ttlMinutes: CAPS.MAX_TTL_MINUTES,
    });
    expect(res.status).toBe(201);
    const { expiresAt } = (await res.json()) as { expiresAt: string };
    const skewMin = (new Date(expiresAt).getTime() - before) / 60_000;
    expect(skewMin).toBeGreaterThan(CAPS.MAX_TTL_MINUTES - 2);
    expect(skewMin).toBeLessThan(CAPS.MAX_TTL_MINUTES + 2);
  });

  test.each([
    ["not an object", "nope"],
    ["empty salt", { salt: "", iterations: 210_000, verifier: VERIFIER }],
    ["iterations below the floor", { salt: SALT, iterations: 99_999, verifier: VERIFIER }],
    ["iterations above the ceiling", { salt: SALT, iterations: 2_000_001, verifier: VERIFIER }],
    ["non-integer iterations", { salt: SALT, iterations: 1.5, verifier: VERIFIER }],
    ["empty verifier", { salt: SALT, iterations: 210_000, verifier: "" }],
  ])("rejects a kdf object that is %s", async (_label, kdf) => {
    const res = await create({ id: freshId(), ciphertext: rawBody, maxViews: 1, kdf });
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: "invalid kdf object" });
  });

  test("stores a valid kdf secret with the verifier hashed at rest", async () => {
    const id = freshId();
    const res = await create({
      id,
      ciphertext: rawBody,
      maxViews: 1,
      kdf: { salt: SALT, iterations: 210_000, verifier: VERIFIER },
    });
    expect(res.status).toBe(201);

    const row = await existingRow(id);
    expect(row.kdf_salt).toBe(SALT);
    expect(row.kdf_iterations).toBe(210_000);
    expect(row.kdf_verifier).toBe(await hashVerifier(SALT, VERIFIER));
    expect(row.kdf_verifier).not.toBe(VERIFIER); // never the raw verifier
  });

  test("rejects a duplicate id with 409", async () => {
    const id = await seed();
    const res = await create({ id, ciphertext: rawBody, maxViews: 1 });
    expect(res.status).toBe(409);
    expect((await res.json()) as unknown).toEqual({ error: "id already exists" });
  });

  test("succeeds with no turnstile token while Turnstile is disabled", async () => {
    expect((await create({ id: freshId(), ciphertext: rawBody, maxViews: 1 })).status).toBe(201);
  });
});

describe("GET /api/secrets/:id (probe)", () => {
  test("404s for an unknown id", async () => {
    const res = await probe(freshId());
    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toEqual({ exists: false });
  });

  test("describes a random-key secret without leaking key material", async () => {
    const id = await seed({ maxViews: 2 });
    const res = await probe(id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ exists: true, requiresPassword: false, viewsRemaining: 2 });
    expect(body).not.toHaveProperty("kdf");
    expect(body).not.toHaveProperty("ciphertext");
    expect(body).not.toHaveProperty("verifier");
  });

  test("exposes kdf salt/iterations but never the verifier for a password secret", async () => {
    const id = await seed({ kdf: { salt: SALT, iterations: 210_000, verifier: VERIFIER } });
    const body = (await (await probe(id)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      exists: true,
      requiresPassword: true,
      kdf: { salt: SALT, iterations: 210_000 },
    });
    expect(JSON.stringify(body)).not.toContain("verifier");
    expect(body).not.toHaveProperty("ciphertext");
  });

  test("does not consume a view", async () => {
    const id = await seed({ maxViews: 1 });
    await probe(id);
    await probe(id);
    await probe(id);
    expect((await existingRow(id)).view_count).toBe(0);
  });

  test("404s a burned secret", async () => {
    const id = await seed();
    await env.DB.prepare("UPDATE secrets SET burned = 1 WHERE id = ?").bind(id).run();
    expect((await probe(id)).status).toBe(404);
  });

  test("404s an expired secret", async () => {
    const id = await seed();
    await env.DB.prepare("UPDATE secrets SET expires_at = ? WHERE id = ?")
      .bind("2000-01-01T00:00:00.000Z", id)
      .run();
    expect((await probe(id)).status).toBe(404);
  });
});

describe("POST /api/secrets/:id/reveal", () => {
  test("returns the ciphertext then hard-deletes a single-view secret", async () => {
    const id = await seed({ maxViews: 1 });
    const res = await reveal(id);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ ciphertext: rawBody });
    expect(await dbRow(id)).toBeNull();
  });

  test("consumes views one at a time and deletes on exhaustion", async () => {
    const id = await seed({ maxViews: CAPS.MAX_VIEWS_CAP });

    for (let i = 1; i <= CAPS.MAX_VIEWS_CAP; i++) {
      const res = await reveal(id);
      expect(res.status).toBe(200);
      if (i < CAPS.MAX_VIEWS_CAP) {
        expect((await existingRow(id)).view_count).toBe(i);
      } else {
        expect(await dbRow(id)).toBeNull();
      }
    }
    expect((await reveal(id)).status).toBe(404);
  });

  test("404s an unknown id", async () => {
    expect((await reveal(freshId())).status).toBe(404);
  });

  test("404s a burned secret", async () => {
    const id = await seed();
    await env.DB.prepare("UPDATE secrets SET burned = 1 WHERE id = ?").bind(id).run();
    expect((await reveal(id)).status).toBe(404);
  });

  test("404s an expired secret", async () => {
    const id = await seed();
    await env.DB.prepare("UPDATE secrets SET expires_at = ? WHERE id = ?")
      .bind("2000-01-01T00:00:00.000Z", id)
      .run();
    expect((await reveal(id)).status).toBe(404);
  });

  test("404s an already-exhausted secret", async () => {
    const id = await seed({ maxViews: 1 });
    await env.DB.prepare("UPDATE secrets SET view_count = 1 WHERE id = ?").bind(id).run();
    expect((await reveal(id)).status).toBe(404);
  });

  describe("password secrets", () => {
    const kdf = { salt: SALT, iterations: 210_000, verifier: VERIFIER };

    test("400s when the verifier is missing, without consuming a view", async () => {
      const id = await seed({ kdf });
      const res = await reveal(id, {});
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/verifier is required/);
      expect((await existingRow(id)).view_count).toBe(0);
      expect((await existingRow(id)).failed_attempts).toBe(0);
    });

    test("a wrong verifier increments failed_attempts but not view_count", async () => {
      const id = await seed({ kdf });
      const res = await reveal(id, { verifier: "d3Jvbmc=" });
      expect(res.status).toBe(401);
      const row = await existingRow(id);
      expect(row.failed_attempts).toBe(1);
      expect(row.view_count).toBe(0);
    });

    test("reaching the failed-attempts cap burns the secret", async () => {
      const id = await seed({ kdf });
      expect((await reveal(id, { verifier: "d3Jvbmc=" })).status).toBe(401); // 1
      expect((await reveal(id, { verifier: "d3Jvbmc=" })).status).toBe(401); // 2 == cap
      expect(await dbRow(id)).toBeNull();
      expect((await probe(id)).status).toBe(404);
    });

    test("a correct verifier reveals and leaves failed_attempts untouched", async () => {
      const id = await seed({ kdf, maxViews: 2 });
      const res = await reveal(id, { verifier: VERIFIER });
      expect(res.status).toBe(200);
      expect((await res.json()) as unknown).toEqual({ ciphertext: rawBody });
      const row = await existingRow(id);
      expect(row.view_count).toBe(1);
      expect(row.failed_attempts).toBe(0);
    });

    test("a wrong attempt then a correct one (below the cap) still succeeds", async () => {
      const id = await seed({ kdf, maxViews: 2 });
      expect((await reveal(id, { verifier: "d3Jvbmc=" })).status).toBe(401);
      expect((await existingRow(id)).failed_attempts).toBe(1);
      expect((await reveal(id, { verifier: VERIFIER })).status).toBe(200);
    });
  });

  test("concurrent reveals on a one-view secret yield exactly one ciphertext", async () => {
    const id = await seed({ maxViews: 1 });

    const results = await Promise.all([...Array(5)].map(() => reveal(id)));
    const statuses = results.map((r: Response) => r.status).sort();
    expect(statuses).toEqual([200, 404, 404, 404, 404]);

    const ok = results.find((r: Response) => r.status === 200)!;
    expect((await ok.json()) as unknown).toEqual({ ciphertext: rawBody });
    expect(await dbRow(id)).toBeNull();
  });
});

describe("DELETE /api/secrets/:id", () => {
  test("burns an existing secret and returns an empty 204", async () => {
    const id = await seed();
    const res = await del(id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await dbRow(id)).toBeNull();
  });

  test("returns 204 for an unknown id (unconditional)", async () => {
    expect((await del(freshId())).status).toBe(204);
  });

  test("after deletion, probe and reveal both 404", async () => {
    const id = await seed();
    await del(id);
    expect((await probe(id)).status).toBe(404);
    expect((await reveal(id)).status).toBe(404);
  });
});

describe("app wiring (index.ts)", () => {
  test("GET /health", async () => {
    const res = await SELF.fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ ok: true });
  });

  test("unknown route 404s with the JSON not-found shape", async () => {
    const res = await SELF.fetch(`${BASE}/nope`);
    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toEqual({ error: "Not Found" });
  });

  test("CORS reflects an allowed origin and withholds it from others", async () => {
    const allowed = await SELF.fetch(`${BASE}/api/secrets`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://test.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://test.example");

    const denied = await SELF.fetch(`${BASE}/api/secrets`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(denied.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });
});
