function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// The verifier is HKDF-derived, effectively random, and never used to derive the
// encryption key — hashing it keyed by the salt just means a DB read alone doesn't
// hand over a value that can be replayed as-is against reveal.
export async function hashVerifier(saltBase64: string, verifierBase64: string): Promise<string> {
  const saltBytes = base64ToBytes(saltBase64);
  const verifierBytes = base64ToBytes(verifierBase64);
  const key = await crypto.subtle.importKey(
    "raw",
    saltBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, verifierBytes);
  return bytesToBase64(signature);
}
