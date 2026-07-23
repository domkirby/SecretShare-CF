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
