import { Hono } from "hono";
import { generateId } from "../lib/id";
import { verifyTurnstile } from "../lib/turnstile";

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;
  TURNSTILE_ENABLED: string;
  TURNSTILE_SECRET_KEY?: string;
  MAX_SECRET_BYTES: string;
  DEFAULT_TTL_MINUTES: string;
  MAX_TTL_MINUTES: string;
  MAX_VIEWS_CAP: string;
}

interface CreateSecretBody {
  ciphertext: string;
  kdf?: { salt: string; iterations: number };
  maxViews: number;
  ttlMinutes?: number;
  turnstileToken?: string;
}

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
  if (body.kdf !== undefined) {
    if (
      typeof body.kdf !== "object" ||
      body.kdf === null ||
      typeof body.kdf.salt !== "string" ||
      body.kdf.salt.length === 0 ||
      typeof body.kdf.iterations !== "number" ||
      !Number.isInteger(body.kdf.iterations) ||
      body.kdf.iterations < 1
    ) {
      return c.json({ error: "invalid kdf object" }, 400);
    }
    kdfSalt = body.kdf.salt;
    kdfIterations = body.kdf.iterations;
  }

  const turnstileOk = await verifyTurnstile(
    c.env,
    body.turnstileToken,
    c.req.header("CF-Connecting-IP")
  );
  if (!turnstileOk) {
    return c.json({ error: "Turnstile verification failed" }, 403);
  }

  const id = generateId();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO secrets (id, ciphertext, kdf_salt, kdf_iterations, max_views, view_count, expires_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  )
    .bind(id, body.ciphertext, kdfSalt, kdfIterations, body.maxViews, expiresAt)
    .run();

  return c.json({ id, expiresAt }, 201);
});

secrets.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT max_views, view_count, expires_at, kdf_salt, burned
     FROM secrets WHERE id = ?`
  )
    .bind(id)
    .first<{
      max_views: number;
      view_count: number;
      expires_at: string;
      kdf_salt: string | null;
      burned: number;
    }>();

  if (!row || row.burned === 1 || new Date(row.expires_at).getTime() < Date.now()) {
    return c.json({ exists: false }, 404);
  }

  return c.json({
    exists: true,
    requiresPassword: row.kdf_salt !== null,
    viewsRemaining: row.max_views - row.view_count,
    expiresAt: row.expires_at,
  });
});

secrets.post("/:id/reveal", async (c) => {
  const id = c.req.param("id");

  const updated = await c.env.DB.prepare(
    `UPDATE secrets
     SET view_count = view_count + 1
     WHERE id = ?
       AND view_count < max_views
       AND burned = 0
       AND expires_at >= datetime('now')
     RETURNING ciphertext, kdf_salt, kdf_iterations, view_count, max_views`
  )
    .bind(id)
    .first<{
      ciphertext: string;
      kdf_salt: string | null;
      kdf_iterations: number | null;
      view_count: number;
      max_views: number;
    }>();

  if (!updated) {
    return c.json({ error: "not found" }, 404);
  }

  const responseBody: {
    ciphertext: string;
    kdf?: { salt: string; iterations: number };
  } = { ciphertext: updated.ciphertext };

  if (updated.kdf_salt !== null && updated.kdf_iterations !== null) {
    responseBody.kdf = { salt: updated.kdf_salt, iterations: updated.kdf_iterations };
  }

  if (updated.view_count >= updated.max_views) {
    await c.env.DB.prepare(`DELETE FROM secrets WHERE id = ?`).bind(id).run();
  }

  return c.json(responseBody, 200);
});

secrets.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(`DELETE FROM secrets WHERE id = ?`).bind(id).run();
  return c.body(null, 204);
});

export default secrets;
