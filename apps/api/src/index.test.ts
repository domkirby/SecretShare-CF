import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";
import worker from "./index";

const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

async function insert(id: string, expiresAt: string, burned = 0) {
  await env.DB.prepare(
    "INSERT INTO secrets (id, ciphertext, max_views, view_count, expires_at, burned) VALUES (?, 'ct', 1, 0, ?, ?)"
  )
    .bind(id, expiresAt, burned)
    .run();
}

async function ids(): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT id FROM secrets ORDER BY id").all<{ id: string }>();
  return results.map((row) => row.id);
}

async function runSweep() {
  const ctx = createExecutionContext();
  // index.ts types the param as ScheduledEvent, but the runtime (and the pool
  // helper) provide a ScheduledController.
  await worker.scheduled(createScheduledController() as unknown as ScheduledEvent, env, ctx);
  await waitOnExecutionContext(ctx); // the handler wraps its DELETE in ctx.waitUntil
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM secrets").run();
});

describe("scheduled() cron sweep", () => {
  test("deletes expired rows, deletes burned rows, keeps live rows", async () => {
    await insert("expired-only-000000000", PAST, 0);
    await insert("burned-not-expired-0000", FUTURE, 1);
    await insert("burned-and-expired-0000", PAST, 1);
    await insert("live-and-unburned-00000", FUTURE, 0);

    await runSweep();

    expect(await ids()).toEqual(["live-and-unburned-00000"]);
  });

  test("is a no-op on an empty table", async () => {
    await expect(runSweep()).resolves.toBeUndefined();
    expect(await ids()).toEqual([]);
  });
});
