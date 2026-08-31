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
  generateFragmentSecret,
  fragmentSecretToBase64Url,
  isValidFragmentSecret,
  generateRandomKey,
  generateSalt,
  generateSecretId,
  generateSecurePassword,
  importKeyBase64Url,
  isValidKeyBase64Url,
  padPlaintext,
  saltToBase64,
  unpadPlaintext,
} from "./crypto";

// Real PBKDF2 at 600k iterations per derivation would dominate the suite; the
// iteration count is a parameter, so exercise the derivation logic cheaply.
const TEST_ITERATIONS = MIN_PBKDF2_ITERATIONS;
const R = () => generateFragmentSecret();

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

describe("padding", () => {
  test("pads an empty payload to a 16-byte block with a zero header", () => {
    const padded = padPlaintext(new Uint8Array(0));
    expect(padded).toHaveLength(16);
    expect(Array.from(padded)).toEqual(new Array(16).fill(0));
  });

  test("adds no padding when header + secret already lands on a 16-byte boundary", () => {
    const padded = padPlaintext(new Uint8Array(12)); // 4-byte header + 12 = 16
    expect(padded).toHaveLength(16);
  });

  test("pads up to the next boundary when 1 byte over", () => {
    const padded = padPlaintext(new Uint8Array(13)); // 4-byte header + 13 = 17
    expect(padded).toHaveLength(32);
  });

  test("round-trips arbitrary binary content", () => {
    const original = crypto.getRandomValues(new Uint8Array(2500));
    const unpadded = unpadPlaintext(padPlaintext(original));
    expect(Array.from(unpadded)).toEqual(Array.from(original));
  });

  test("rejects a header claiming more bytes than remain", () => {
    const bogus = new Uint8Array(16);
    new DataView(bogus.buffer).setUint32(0, 1000, false);
    expect(() => unpadPlaintext(bogus)).toThrow(/Malformed plaintext padding/);
  });

  test("rejects a buffer too short to hold the header", () => {
    expect(() => unpadPlaintext(new Uint8Array(2))).toThrow(/Malformed plaintext padding/);
  });

  test("round-trips an empty secret end-to-end", async () => {
    const id = generateSecretId();
    const key = await generateRandomKey();
    const { ciphertext } = await encryptData("", key, id);
    expect(await decryptData(ciphertext, key, id)).toBe("");
  });

  test("round-trips a realistic SSH-key-sized secret", async () => {
    const id = generateSecretId();
    const key = await generateRandomKey();
    const sshKey =
      "-----BEGIN OPENSSH PRIVATE KEY-----\n" +
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAB".repeat(60) +
      "\n-----END OPENSSH PRIVATE KEY-----\n";
    const { ciphertext } = await encryptData(sshKey, key, id);
    expect(await decryptData(ciphertext, key, id)).toBe(sshKey);
  });
});

describe("password mode", () => {
  test("the same password, salt and R re-derive the same key and verifier", async () => {
    const salt = generateSalt();
    const r = R();
    const a = await deriveKeyAndVerifier("correct horse", salt, TEST_ITERATIONS, r);
    const b = await deriveKeyAndVerifier("correct horse", salt, TEST_ITERATIONS, r);
    expect(a.verifier).toBe(b.verifier);

    // And the keys actually interoperate, not just the verifiers.
    const id = generateSecretId();
    const { ciphertext } = await encryptData("secret", a.key, id);
    expect(await decryptData(ciphertext, b.key, id)).toBe("secret");
  });

  test("decryption needs both the password and R", async () => {
    const salt = generateSalt();
    const id = generateSecretId();
    const enc = await deriveKeyAndVerifier("correct horse", salt, TEST_ITERATIONS, R());
    const { ciphertext } = await encryptData("secret", enc.key, id);

    // Right password, wrong R (e.g. a leaked DB but not the link).
    const wrongR = await deriveKeyAndVerifier("correct horse", salt, TEST_ITERATIONS, R());
    await expect(decryptData(ciphertext, wrongR.key, id)).rejects.toThrow();
  });

  test("the verifier does not depend on R", async () => {
    // R lives only in the fragment; the server-side check must work without it.
    const salt = generateSalt();
    const a = await deriveKeyAndVerifier("pw", salt, TEST_ITERATIONS, R());
    const b = await deriveKeyAndVerifier("pw", salt, TEST_ITERATIONS, R());
    expect(a.verifier).toBe(b.verifier);
  });

  test("rejects a fragment secret that isn't 32 bytes", async () => {
    await expect(
      deriveKeyAndVerifier("pw", generateSalt(), TEST_ITERATIONS, new Uint8Array(16))
    ).rejects.toThrow(/fragment secret/i);
  });

  test("a wrong password produces a different verifier", async () => {
    const salt = generateSalt();
    const r = R();
    const right = await deriveKeyAndVerifier("correct horse", salt, TEST_ITERATIONS, r);
    const wrong = await deriveKeyAndVerifier("correct horsé", salt, TEST_ITERATIONS, r);
    expect(wrong.verifier).not.toBe(right.verifier);
  });

  test("a different salt produces a different verifier for the same password", async () => {
    const a = await deriveKeyAndVerifier("pw", generateSalt(), TEST_ITERATIONS, R());
    const b = await deriveKeyAndVerifier("pw", generateSalt(), TEST_ITERATIONS, R());
    expect(a.verifier).not.toBe(b.verifier);
  });

  test("a different iteration count produces a different verifier", async () => {
    const salt = generateSalt();
    const r = R();
    const a = await deriveKeyAndVerifier("pw", salt, TEST_ITERATIONS, r);
    const b = await deriveKeyAndVerifier("pw", salt, TEST_ITERATIONS + 1, r);
    expect(a.verifier).not.toBe(b.verifier);
  });

  test("the verifier is not the key material", async () => {
    // The verifier goes to the server; the key must not be recoverable from it.
    const { key, verifier } = await deriveKeyAndVerifier("pw", generateSalt(), TEST_ITERATIONS, R());
    expect(key.extractable).toBe(false);
    expect(atob(verifier)).toHaveLength(32);
  });

  test("R round-trips base64url and matches the exported-key shape", () => {
    const r = generateFragmentSecret();
    expect(r).toHaveLength(32);
    const encoded = fragmentSecretToBase64Url(r);
    expect(encoded).toHaveLength(43);
    expect(isValidFragmentSecret(encoded)).toBe(true);
    expect(encoded).not.toMatch(/[+/=]/);
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
      // The API accepts only canonical encodings of 16 bytes, so the final
      // character must be one whose low 4 bits are zero.
      expect(generateSecretId()).toMatch(/^[A-Za-z0-9_-]{21}[AQgw]$/);
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
