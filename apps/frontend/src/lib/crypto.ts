function bufToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuf(hex: string): Uint8Array {
  if (hex.length === 0 || hex.length % 2 !== 0) {
    throw new Error("Invalid key hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
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

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export const PBKDF2_ITERATIONS = 350_000;

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

export async function importKeyHex(hex: string): Promise<CryptoKey> {
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

export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Independent PBKDF2 derivation from the same password/iterations but a
 * distinct salt (real salt + ":verify" suffix), so the server can check a
 * password before spending a view — without ever holding anything that
 * lets it recover encKey.
 */
export async function deriveVerifier(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<string> {
  const verifierSalt = concatBytes(salt, new TextEncoder().encode(":verify"));
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: verifierSalt as BufferSource, iterations, hash: "SHA-256" },
    passwordKey,
    256
  );
  return bufToBase64(new Uint8Array(bits));
}

/** CSPRNG-based suggestion for password mode; not the only allowed password. */
export function generateSecurePassword(length = 20): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function encryptData(
  plaintext: string,
  key: CryptoKey
): Promise<{ ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainBytes = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainBytes);
  const envelope = `${bufToBase64(iv)}:${bufToBase64(new Uint8Array(cipherBuf))}`;
  return { ciphertext: envelope };
}

export async function decryptData(envelope: string, key: CryptoKey): Promise<string> {
  const sepIdx = envelope.indexOf(":");
  if (sepIdx === -1) throw new Error("Malformed ciphertext envelope");
  const ivB64 = envelope.slice(0, sepIdx);
  const dataB64 = envelope.slice(sepIdx + 1);
  const iv = base64ToBuf(ivB64);
  const data = base64ToBuf(dataB64);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    data as BufferSource
  );
  return new TextDecoder().decode(plainBuf);
}
