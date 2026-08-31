import { Hono } from "hono";
import { verifyTurnstile } from "../lib/turnstile";
import { timingSafeEqual } from "../lib/timingSafeEqual";
import { hashVerifier } from "../lib/verifierHash";

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;
  TURNSTILE_ENABLED: string;
  TURNSTILE_SECRET_KEY?: string;
  MAX_SECRET_BYTES: string;
  DEFAULT_TTL_MINUTES: string;
  MAX_TTL_MINUTES: string;
  MAX_VIEWS_CAP: string;
  FAILED_ATTEMPTS_CAP: string;
}

interface CreateSecretBody {
  id: string;
  ciphertext: string;
  kdf?: { salt: string; iterations: number; verifier: string };
  maxViews: number;
  ttlMinutes?: number;
  turnstileToken?: string;
}

// Client-generated: 16 random bytes, base64url without padding. The client
// binds this id into the ciphertext as AES-GCM AAD, so it must exist before
// encryption and cannot be assigned server-side. Since it arrives from the
// client, the server re-checks the shape rather than trusting it.
//
// 16 bytes is 128 bits, which unpadded base64url spells in 22 characters: the
// first 21 carry 126 bits and the last carries the remaining 2 bits followed by
// 4 zero bits. Only A (0b000000), Q (0b010000), g (0b100000) and w (0b110000)
// have those low bits clear, so any other final character is a non-canonical
// encoding that does not decode to exactly 16 bytes.
const ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/;

const MIN_KDF_ITERATIONS = 100_000;
const MAX_KDF_ITERATIONS = 2_000_000;

const secrets = new Hono<{ Bindings: Env }>();

secrets.post("/", async (c) => {
  let body: CreateSecretBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const maxSecretBytes = Number(c.env.MAX_SECRET_BYTES);
  const defaultTtl = Number(c.env.DEFAULT_TTL_MINUTES);
  const maxTtl = Number(c.env.MAX_TTL_MINUTES);
  const maxViewsCap = Number(c.env.MAX_VIEWS_CAP);

  if (typeof body.id !== "string" || !ID_PATTERN.test(body.id)) {
    return c.json({ error: "id must be 22 base64url characters encoding 16 bytes" }, 400);
  }

  if (typeof body.ciphertext !== "string" || body.ciphertext.length === 0) {
    return c.json({ error: "ciphertext is required" }, 400);
  }
  const byteLen = new TextEncoder().encode(body.ciphertext).length;
  if (byteLen > maxSecretBytes) {
    return c.json({ error: `ciphertext exceeds ${maxSecretBytes} bytes` }, 413);
  }

  if (
    typeof body.maxViews !== "number" ||
    !Number.isInteger(body.maxViews) ||
    body.maxViews < 1 ||
    body.maxViews > maxViewsCap
  ) {
    return c.json({ error: `maxViews must be an integer between 1 and ${maxViewsCap}` }, 400);
  }

  let ttlMinutes = defaultTtl;
  if (body.ttlMinutes !== undefined) {
    if (
      typeof body.ttlMinutes !== "number" ||
      !Number.isInteger(body.ttlMinutes) ||
      body.ttlMinutes < 1 ||
      body.ttlMinutes > maxTtl
    ) {
      return c.json({ error: `ttlMinutes must be an integer between 1 and ${maxTtl}` }, 400);
    }
    ttlMinutes = body.ttlMinutes;
  }

  let kdfSalt: string | null = null;
  let kdfIterations: number | null = null;
  let kdfVerifier: string | null = null;
  if (body.kdf !== undefined) {
    if (
      typeof body.kdf !== "object" ||
      body.kdf === null ||
      typeof body.kdf.salt !== "string" ||
      body.kdf.salt.length === 0 ||
      typeof body.kdf.iterations !== "number" ||
      !Number.isInteger(body.kdf.iterations) ||
      body.kdf.iterations < MIN_KDF_ITERATIONS ||
      body.kdf.iterations > MAX_KDF_ITERATIONS ||
      typeof body.kdf.verifier !== "string" ||
      body.kdf.verifier.length === 0
    ) {
      return c.json({ error: "invalid kdf object" }, 400);
    }
    kdfSalt = body.kdf.salt;
    kdfIterations = body.kdf.iterations;
    kdfVerifier = await hashVerifier(body.kdf.salt, body.kdf.verifier);
  }

  const turnstileOk = await verifyTurnstile(
    c.env,
    body.turnstileToken,
    c.req.header("CF-Connecting-IP")
  );
  if (!turnstileOk) {
    return c.json({ error: "Turnstile verification failed" }, 403);
  }

  const id = body.id;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  try {
    await c.env.DB.prepare(
      `INSERT INTO secrets (id, ciphertext, kdf_salt, kdf_iterations, kdf_verifier, max_views, view_count, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    )
      .bind(id, body.ciphertext, kdfSalt, kdfIterations, kdfVerifier, body.maxViews, expiresAt)
      .run();
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
      return c.json({ error: "id already exists" }, 409);
    }
    throw e;
  }

  return c.json({ id, expiresAt }, 201);
});

secrets.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT max_views, view_count, expires_at, kdf_salt, kdf_iterations, burned
     FROM secrets WHERE id = ?`
  )
    .bind(id)
    .first<{
      max_views: number;
      view_count: number;
      expires_at: string;
      kdf_salt: string | null;
      kdf_iterations: number | null;
      burned: number;
    }>();

  if (!row || row.burned === 1 || new Date(row.expires_at).getTime() < Date.now()) {
    return c.json({ exists: false }, 404);
  }

  const requiresPassword = row.kdf_salt !== null;

  return c.json({
    exists: true,
    requiresPassword,
    ...(requiresPassword && { kdf: { salt: row.kdf_salt, iterations: row.kdf_iterations } }),
    viewsRemaining: row.max_views - row.view_count,
    expiresAt: row.expires_at,
  });
});

secrets.post("/:id/reveal", async (c) => {
  const id = c.req.param("id");

  let body: { verifier?: string; turnstileToken?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // no body sent (e.g. Turnstile disabled) — treated as empty
  }

  const turnstileOk = await verifyTurnstile(
    c.env,
    body.turnstileToken,
    c.req.header("CF-Connecting-IP")
  );
  if (!turnstileOk) {
    return c.json({ error: "Turnstile verification failed" }, 403);
  }

  const row = await c.env.DB.prepare(
    `SELECT kdf_verifier, kdf_salt, burned, expires_at, failed_attempts, view_count, max_views
     FROM secrets WHERE id = ?`
  )
    .bind(id)
    .first<{
      kdf_verifier: string | null;
      kdf_salt: string | null;
      burned: number;
      expires_at: string;
      failed_attempts: number;
      view_count: number;
      max_views: number;
    }>();

  if (
    !row ||
    row.burned === 1 ||
    new Date(row.expires_at).getTime() < Date.now() ||
    row.view_count >= row.max_views
  ) {
    return c.json({ error: "not found" }, 404);
  }

  if (row.kdf_salt !== null) {
    if (typeof body.verifier !== "string" || body.verifier.length === 0) {
      return c.json({ error: "verifier is required" }, 400);
    }

    const expected = await hashVerifier(row.kdf_salt, body.verifier);
    if (!timingSafeEqual(expected, row.kdf_verifier ?? "")) {
      const failedAttemptsCap = Number(c.env.FAILED_ATTEMPTS_CAP);
      const newFailedAttempts = row.failed_attempts + 1;
      if (newFailedAttempts >= failedAttemptsCap) {
        await c.env.DB.prepare(`DELETE FROM secrets WHERE id = ?`).bind(id).run();
      } else {
        await c.env.DB.prepare(`UPDATE secrets SET failed_attempts = ? WHERE id = ?`)
          .bind(newFailedAttempts, id)
          .run();
      }
      return c.json({ error: "invalid password" }, 401);
    }
  }

  const updated = await c.env.DB.prepare(
    `UPDATE secrets
     SET view_count = view_count + 1
     WHERE id = ?
       AND view_count < max_views
       AND burned = 0
       AND expires_at >= datetime('now')
     RETURNING ciphertext, view_count, max_views`
  )
    .bind(id)
    .first<{
      ciphertext: string;
      view_count: number;
      max_views: number;
    }>();

  if (!updated) {
    return c.json({ error: "not found" }, 404);
  }

  if (updated.view_count >= updated.max_views) {
    await c.env.DB.prepare(`DELETE FROM secrets WHERE id = ?`).bind(id).run();
  }

  return c.json({ ciphertext: updated.ciphertext }, 200);
});

secrets.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(`DELETE FROM secrets WHERE id = ?`).bind(id).run();
  return c.body(null, 204);
});

export default secrets;
