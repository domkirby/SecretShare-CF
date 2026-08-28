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

function bufToBase64Url(bytes: Uint8Array): string {
  return bufToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBuf(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBuf(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

/**
 * Prepends a 4-byte big-endian length header to `bytes`, then zero-pads to
 * the next 16-byte boundary (no padding added if already aligned). This
 * hides the exact plaintext length from anyone who only sees ciphertext
 * length — GCM ciphertext is exactly as long as its plaintext, so without
 * this a secret's byte count would leak for free.
 */
export function padPlaintext(bytes: Uint8Array): Uint8Array {
  const totalLen = 4 + bytes.length;
  const paddedLen = totalLen % 16 === 0 ? totalLen : totalLen + (16 - (totalLen % 16));
  const out = new Uint8Array(paddedLen);
  new DataView(out.buffer).setUint32(0, bytes.length, false);
  out.set(bytes, 4);
  return out;
}

/** Inverse of {@link padPlaintext}: reads the length header and returns exactly that many bytes. */
export function unpadPlaintext(padded: Uint8Array): Uint8Array {
  if (padded.length < 4) {
    throw new Error("Malformed plaintext padding");
  }
  const n = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0, false);
  if (n > padded.length - 4) {
    throw new Error("Malformed plaintext padding");
  }
  return padded.slice(4, 4 + n);
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
// v2: the encryption key is expanded from PBKDF2 output *concatenated with* the
// 32-byte fragment secret R, not from the PBKDF2 output alone (see
// deriveKeyAndVerifier). The verify label stays v1 — that derivation is
// unchanged.
const HKDF_INFO_ENC = "secretshare:v2:enc";
const HKDF_INFO_VERIFY = "secretshare:v1:verify";
// 32 key bytes as unpadded base64url — always exactly 43 chars. Also the shape
// of the password-mode fragment secret R.
const KEY_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FRAGMENT_SECRET_BYTES = 32;

export async function generateRandomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function exportKeyBase64Url(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bufToBase64Url(new Uint8Array(raw));
}

export function isValidKeyBase64Url(s: string): boolean {
  return KEY_BASE64URL_PATTERN.test(s);
}

export async function importKeyBase64Url(s: string): Promise<CryptoKey> {
  if (!isValidKeyBase64Url(s)) {
    throw new Error("Invalid key");
  }
  const raw = base64UrlToBuf(s);
  if (raw.length !== 32) {
    throw new Error("Invalid key");
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["decrypt"]);
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Password-mode fragment secret `R`: 32 random bytes carried only in the share
 * link's URL fragment (never sent to the server) and mixed into the encryption
 * key derivation. Decryption needs both the password and this value.
 */
export function generateFragmentSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(FRAGMENT_SECRET_BYTES));
}

export function fragmentSecretToBase64Url(r: Uint8Array): string {
  return bufToBase64Url(r);
}

export function base64UrlToFragmentSecret(s: string): Uint8Array {
  const r = base64UrlToBuf(s);
  if (r.length !== FRAGMENT_SECRET_BYTES) {
    throw new Error("Invalid fragment secret");
  }
  return r;
}

/** Same shape as an exported random-mode key: 43 unpadded base64url chars. */
export const isValidFragmentSecret = isValidKeyBase64Url;

export function saltToBase64(salt: Uint8Array): string {
  return bufToBase64(salt);
}

export function base64ToSalt(b64: string): Uint8Array {
  return base64ToBuf(b64);
}

/** Client-generated secret id: 16 random bytes as base64url (22 chars, no padding). */
export function generateSecretId(): string {
  return bufToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Hybrid (1Password-style) derivation. One PBKDF2-SHA256 block (256 bits —
 * asking for more would cost the full iteration count per extra block, while an
 * attacker cracking the verifier only ever needs one) is the password-derived
 * key `pdk`.
 *
 * - **Verifier** = HKDF-Expand(pdk, info="…:v1:verify"). Depends on the password
 *   only, so the server can check a password without learning the key. Mixing
 *   `R` in here would gain nothing and would stop the server-side check from
 *   working, so it is deliberately `pdk`-only and unchanged from v1.
 * - **Encryption key** = HKDF-Expand(pdk ‖ R, info="…:v2:enc"), where `R` is the
 *   32-byte {@link generateFragmentSecret} value that lives only in the URL
 *   fragment. Decryption needs both the password (for `pdk`) and the link (for
 *   `R`): a server/D1 leak alone yields the salt and verifier but not `R`, so a
 *   weak password can no longer be brute-forced down to plaintext.
 *
 * Empty HKDF salt is fine: the inputs are already uniform, so this is
 * expand-only usage per RFC 5869. The two HMACs are free next to the PBKDF2.
 */
export async function deriveKeyAndVerifier(
  password: string,
  salt: Uint8Array,
  iterations: number,
  fragmentSecret: Uint8Array
): Promise<{ key: CryptoKey; verifier: string }> {
  if (fragmentSecret.length !== FRAGMENT_SECRET_BYTES) {
    throw new Error("Invalid fragment secret");
  }
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const pdkBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    passwordKey,
    256
  );
  const pdk = new Uint8Array(pdkBits);

  const encIkm = new Uint8Array(pdk.length + fragmentSecret.length);
  encIkm.set(pdk, 0);
  encIkm.set(fragmentSecret, pdk.length);
  const encHkdfKey = await crypto.subtle.importKey("raw", encIkm as BufferSource, "HKDF", false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(HKDF_INFO_ENC),
    },
    encHkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  const verifyHkdfKey = await crypto.subtle.importKey("raw", pdk as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const verifierBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(HKDF_INFO_VERIFY),
    },
    verifyHkdfKey,
    256
  );
  return { key, verifier: bufToBase64(new Uint8Array(verifierBits)) };
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
  const plainBytes = padPlaintext(new TextEncoder().encode(plaintext));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    plainBytes as BufferSource
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
  return new TextDecoder().decode(unpadPlaintext(new Uint8Array(plainBuf)));
}
