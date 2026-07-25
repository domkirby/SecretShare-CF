function bufToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuf(hex: string): Uint8Array {
  if (hex.length === 0 || hex.length % 2 !== 0) {
    throw new Error("Invalid key hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bufToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export const PBKDF2_ITERATIONS = 600_000;
/**
 * Accepted range for server-supplied iteration counts. The value round-trips
 * through the server, so the client must refuse anything outside these bounds:
 * too low weakens brute-force resistance, too high is a browser DoS.
 */
export const MIN_PBKDF2_ITERATIONS = 100_000;
export const MAX_PBKDF2_ITERATIONS = 2_000_000;

const ENVELOPE_VERSION = "v1";
const KEY_HEX_PATTERN = /^[0-9a-f]{64}$/i;

export async function generateRandomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function exportKeyHex(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bufToHex(new Uint8Array(raw));
}

export function isValidKeyHex(hex: string): boolean {
  return KEY_HEX_PATTERN.test(hex);
}

export async function importKeyHex(hex: string): Promise<CryptoKey> {
  if (!isValidKeyHex(hex)) {
    throw new Error("Invalid key hex");
  }
  const raw = hexToBuf(hex);
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["decrypt"]);
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export function saltToBase64(salt: Uint8Array): string {
  return bufToBase64(salt);
}

export function base64ToSalt(b64: string): Uint8Array {
  return base64ToBuf(b64);
}

/** Client-generated secret id: 16 random bytes as base64url (22 chars, no padding). */
export function generateSecretId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bufToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Single PBKDF2 run producing 512 bits, split into the AES key (first 256)
 * and the server-checkable verifier (last 256). Domain separation comes from
 * the split itself, so the verifier never lets the server recover the key —
 * and the user pays one derivation where an attacker also pays one per guess.
 */
export async function deriveKeyAndVerifier(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<{ key: CryptoKey; verifier: string }> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    passwordKey,
    512
  );
  const key = await crypto.subtle.importKey(
    "raw",
    bits.slice(0, 32),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
  return { key, verifier: bufToBase64(new Uint8Array(bits.slice(32))) };
}

/** CSPRNG-based suggestion for password mode; not the only allowed password. */
export function generateSecurePassword(length = 20): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * `aad` (the secret id) is authenticated but not encrypted: decryption fails
 * if the ciphertext is presented under any other id, so the server can't swap
 * ciphertexts between records undetected.
 */
export async function encryptData(
  plaintext: string,
  key: CryptoKey,
  aad: string
): Promise<{ ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainBytes = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    plainBytes
  );
  const envelope = `${ENVELOPE_VERSION}:${bufToBase64(iv)}:${bufToBase64(new Uint8Array(cipherBuf))}`;
  return { ciphertext: envelope };
}

export async function decryptData(envelope: string, key: CryptoKey, aad: string): Promise<string> {
  const parts = envelope.split(":");
  if (parts.length !== 3 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error("Malformed ciphertext envelope");
  }
  const iv = base64ToBuf(parts[1]);
  const data = base64ToBuf(parts[2]);
  if (iv.length !== 12 || data.length === 0) {
    throw new Error("Malformed ciphertext envelope");
  }
  const plainBuf = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: new TextEncoder().encode(aad),
    },
    key,
    data as BufferSource
  );
  return new TextDecoder().decode(plainBuf);
}
