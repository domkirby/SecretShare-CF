import { describe, expect, test } from "vitest";
import { hashVerifier } from "./verifierHash";

// Fixed inputs so a change to the derivation shows up as a failing test rather
// than as silently unreadable existing rows.
const SALT = "AAECAwQFBgcICQoLDA0ODw==";        // 16 bytes, 0x00..0x0f
const VERIFIER = "EBESExQVFhcYGRobHB0eHw==";     // 16 bytes, 0x10..0x1f

describe("hashVerifier", () => {
  test("is deterministic for the same salt and verifier", async () => {
    const a = await hashVerifier(SALT, VERIFIER);
    const b = await hashVerifier(SALT, VERIFIER);
    expect(a).toBe(b);
  });

  test("produces base64 of a 32-byte HMAC-SHA-256 output", async () => {
    const hash = await hashVerifier(SALT, VERIFIER);
    expect(hash).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(atob(hash)).toHaveLength(32);
  });

  test("known answer — HMAC-SHA-256 keyed by the salt over the verifier", async () => {
    // Independently computed via WebCrypto, keyed by salt, message = verifier.
    // This pins the argument order: swapping key and message would still be a
    // valid HMAC, but would not match rows already stored.
    const expected = await referenceHmac(SALT, VERIFIER);
    expect(await hashVerifier(SALT, VERIFIER)).toBe(expected);
  });

  test("a different verifier under the same salt gives a different hash", async () => {
    const other = "ISITFBUWFxgZGhscHR4fIA==";
    expect(await hashVerifier(SALT, other)).not.toBe(await hashVerifier(SALT, VERIFIER));
  });

  test("the same verifier under a different salt gives a different hash", async () => {
    // Per-secret salting is what stops one cracked verifier from applying
    // across records.
    const otherSalt = "DwoNDAsKCQgHBgUEAwIBAA==";
    expect(await hashVerifier(otherSalt, VERIFIER)).not.toBe(await hashVerifier(SALT, VERIFIER));
  });

  test("hashes are fixed length regardless of verifier length", async () => {
    const short = await hashVerifier(SALT, "AAAA");
    const long = await hashVerifier(SALT, btoa("x".repeat(200)));
    expect(atob(short)).toHaveLength(32);
    expect(atob(long)).toHaveLength(32);
  });
});

async function referenceHmac(saltBase64: string, verifierBase64: string): Promise<string> {
  const toBytes = (b64: string) =>
    Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    toBytes(saltBase64),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, toBytes(verifierBase64));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
