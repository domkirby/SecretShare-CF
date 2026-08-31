import { Hono } from "hono";
import { cors } from "hono/cors";
import secretsRoute, { type Env } from "./routes/secrets";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const allowedOrigins = c.env.ALLOWED_ORIGIN.split(",").map((o) => o.trim());
  return cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })(c, next);
});

// Hardening headers on every response, including the errors and the 404 below.
// This Worker only ever returns JSON, so the policy can be far tighter than the
// frontend's: nothing here should ever be loaded as a document, framed, or
// treated as anything other than what its Content-Type says.
//
// No Strict-Transport-Security — HSTS pins the whole domain and belongs in the
// zone's settings, not in application code. Set after next() so it applies to
// the finished response, and touching no Access-Control-* header, which is the
// CORS middleware's business.
app.use("*", async (c, next) => {
  await next();
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

app.notFound((c) => c.json({ error: "Not Found" }, 404));

app.get("/health", (c) => c.json({ ok: true }));

app.route("/api/secrets", secretsRoute);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      env.DB.prepare(`DELETE FROM secrets WHERE expires_at < datetime('now') OR burned = 1`).run()
    );
  },
};
