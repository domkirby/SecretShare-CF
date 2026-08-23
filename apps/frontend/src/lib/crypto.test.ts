import { describe, expect, test } from "vitest";
import {
  MAX_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS,
  base64ToSalt,
  decryptData,
  deriveKeyAndVerifier,
  encryptData,
  exportKeyBase64Url,
  generateRandomKey,
  generateSalt,
  generateSecretId,
  generateSecurePassword,
  importKeyBase64Url,
  isValidKeyBase64Url,
  saltToBase64,
} from "./crypto";

// Real PBKDF2 at 600k iterations per derivation would dominate the suite; the
// iteration count is a parameter, so exercise the derivation logic cheaply.
const TEST_ITERATIONS = MIN_PBKDF2_ITERATIONS;

describe("random-key mode", () => {
  test("round-trips a secret", async () => {
    const id = generateSecretId();
    const key = await generateRandomKey();
    const { ciphertext } = await encryptData("hunter2", key, id);

    const imported = await importKeyBase64Url(await exportKeyBase64Url(key));
    expect(await decryptData(ciphertext, imported, id)).toBe("hunter2");
  });

  test("round-trips unicode and long plaintext", async () => {
    const id = generateSecretId();
    const key = await generateRandomKey();
    const plaintext = "🔐 sécret\nline two\t" + "x".repeat(10_000);
    const { ciphertext } = await encryptData(plaintext, key, id);
    expect(await decryptData(ciphertext, key, id)).toBe(plaintext);
  });

  test("round-trips an empty string", async () => {
    const id = generateSecretId();
    const key = await generateRandomKey();
    const { ciphertext } = await encryptData("", key, id);
    expect(await decryptData(ciphertext, key, id)).toBe("");
  });

  test("uses a fresh IV, so the same plaintext encrypts differently each time", async () => {
    const id = generateSecretId();
    const key = await generateRandomKey();
    const a = await encryptData("same", key, id);
    const b = await encryptData("same", key, id);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  test("exported keys are 43 base64url characters", async () => {
    const exported = await exportKeyBase64Url(await generateRandomKey());
    expect(exported).toHaveLength(43);
    expect(isValidKeyBase64Url(exported)).toBe(true);
    // base64url only — a "+" or "/" would be mangled in a URL fragment.
    expect(exported).not.toMatch(/[+/=]/);
  });

  test("rejects malformed keys rather than importing them", async () => {
    for (const bad of ["", "short", "A".repeat(42), "A".repeat(44), "A".repeat(42) + "+"]) {
      expect(isValidKeyBase64Url(bad)).toBe(false);
      await expect(importKeyBase64Url(bad)).rejects.toThrow(/Invalid key/);
    }
  });
});

describe("AAD binds a ciphertext to its id", () => {
  test("decryption fails under a different id", async () => {
    // This is what stops the server swapping ciphertexts between records.
    const key = await generateRandomKey();
    const { ciphertext } = await encryptData("secret", key, generateSecretId());
    await expect(decryptData(ciphertext, key, generateSecretId())).rejects.toThrow();
  });

  test("decryption fails under a different key", async () => {
    const id = generateSecretId();
    const { ciphertext } = await encryptData("secret", await generateRandomKey(), id);
    await expect(decryptData(ciphertext, await generateRandomKey(), id)).rejects.toThrow();
  });

  test("decryption fails when the ciphertext is tampered with", async () => {
    const id = generateSecretId();
    const key = await generateRandomKey();
    const { ciphertext } = await encryptData("secret", key, id);
    const [version, iv, data] = ciphertext.split(":");
    const flipped = data[0] === "A" ? "B" + data.slice(1) : "A" + data.slice(1);
    await expect(decryptData(`${version}:${iv}:${flipped}`, key, id)).rejects.toThrow();
  });
});

describe("envelope format", () => {
  test("is v1:iv:ciphertext with a 12-byte IV", async () => {
    const { ciphertext } = await encryptData("x", await generateRandomKey(), generateSecretId());
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("v1");
    expect(atob(parts[1])).toHaveLength(12);
  });

  test("rejects anything that isn't a well-formed v1 envelope", async () => {
    const key = await generateRandomKey();
    const id = generateSecretId();
    const { ciphertext } = await encryptData("x", key, id);
    const [, iv, data] = ciphertext.split(":");

    const malformed = [
      "",
      "not-an-envelope",
      `v2:${iv}:${data}`,                       // unknown version tag
      `${iv}:${data}`,                          // missing version
      `v1:${iv}:${data}:extra`,                 // too many parts
      `v1:${btoa("short")}:${data}`,            // IV not 12 bytes
      `v1:${iv}:`,                              // empty ciphertext
    ];
    for (const envelope of malformed) {
      await expect(decryptData(envelope, key, id)).rejects.toThrow();
    }
  });
});

describe("password mode", () => {
  test("the same password and salt re-derive the same key and verifier", async () => {
    const salt = generateSalt();
    const a = await deriveKeyAndVerifier("correct horse", salt, TEST_ITERATIONS);
    const b = await deriveKeyAndVerifier("correct horse", salt, TEST_ITERATIONS);
    expect(a.verifier).toBe(b.verifier);

    // And the keys actually interoperate, not just the verifiers.
    const id = generateSecretId();
    const { ciphertext } = await encryptData("secret", a.key, id);
    expect(await decryptData(ciphertext, b.key, id)).toBe("secret");
  });

  test("a wrong password produces a different verifier", async () => {
    const salt = generateSalt();
    const right = await deriveKeyAndVerifier("correct horse", salt, TEST_ITERATIONS);
    const wrong = await deriveKeyAndVerifier("correct horsé", salt, TEST_ITERATIONS);
    expect(wrong.verifier).not.toBe(right.verifier);
  });

  test("a different salt produces a different verifier for the same password", async () => {
    const a = await deriveKeyAndVerifier("pw", generateSalt(), TEST_ITERATIONS);
    const b = await deriveKeyAndVerifier("pw", generateSalt(), TEST_ITERATIONS);
    expect(a.verifier).not.toBe(b.verifier);
  });

  test("a different iteration count produces a different verifier", async () => {
    const salt = generateSalt();
    const a = await deriveKeyAndVerifier("pw", salt, TEST_ITERATIONS);
    const b = await deriveKeyAndVerifier("pw", salt, TEST_ITERATIONS + 1);
    expect(a.verifier).not.toBe(b.verifier);
  });

  test("the verifier is not the key material", async () => {
    // The verifier goes to the server; the key must not be recoverable from it.
    const { key, verifier } = await deriveKeyAndVerifier("pw", generateSalt(), TEST_ITERATIONS);
    expect(key.extractable).toBe(false);
    expect(atob(verifier)).toHaveLength(32);
  });

  test("salt survives the base64 round-trip the API does", async () => {
    const salt = generateSalt();
    expect(salt).toHaveLength(16);
    expect(Array.from(base64ToSalt(saltToBase64(salt)))).toEqual(Array.from(salt));
  });

  test("the shipped iteration count sits inside the accepted range", () => {
    // RevealSecret rejects server-supplied counts outside these bounds, so the
    // count we create secrets with has to be one we'd accept back.
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(MIN_PBKDF2_ITERATIONS);
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(MAX_PBKDF2_ITERATIONS);
  });
});

describe("id and password generation", () => {
  test("ids match the format the API validates", async () => {
    for (let i = 0; i < 50; i++) {
      expect(generateSecretId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  test("ids and keys do not repeat", async () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateSecretId()));
    expect(ids.size).toBe(200);
  });

  test("generated passwords are the requested length and unambiguous", () => {
    expect(generateSecurePassword()).toHaveLength(20);
    expect(generateSecurePassword(32)).toHaveLength(32);
    // Excludes look-alike characters (I, l, O, 0, 1).
    for (let i = 0; i < 20; i++) {
      expect(generateSecurePassword(64)).not.toMatch(/[IlO01]/);
    }
  });

  test("generated passwords do not repeat", () => {
    const passwords = new Set(Array.from({ length: 200 }, () => generateSecurePassword()));
    expect(passwords.size).toBe(200);
  });
});
