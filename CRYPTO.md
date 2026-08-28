# Cryptography

SecretShare encrypts and decrypts secrets entirely in the browser using the
Web Crypto API (`crypto.subtle`). The server only ever stores and serves
opaque ciphertext — it never has access to plaintext or key material. All of
the logic described here lives in `apps/frontend/src/lib/crypto.ts`.

## Threat model

- The server operator, and anyone who can observe traffic to/from it, can see
  ciphertext, its length, timing, and metadata (secret id, expiry, etc.) —
  but not plaintext, keys, or passwords.
- A full server/D1 leak yields the salt, iteration count, and verifier for a
  password secret, but **not** the fragment secret `R` (it lives only in the
  URL fragment). Without `R` the encryption key can't be assembled even from a
  correctly guessed password, so an offline brute-force of a weak password
  recovers the verifier, not the plaintext.
- Ciphertext length does **not** reveal the exact byte length of the
  original secret (see "Length-hiding padding" below). It does not hide the
  secret's *category* (e.g. "this looks like an SSH key vs. a password") —
  that would require bucket-tier padding, which is intentionally out of
  scope today.
- The server cannot swap a ciphertext between two different secret records
  undetected (see AAD binding below).

## Key modes

Two ways to obtain the AES-256-GCM key used for a given secret:

### Random-key mode

`generateRandomKey()` generates a fresh random AES-256-GCM key via
`crypto.subtle.generateKey`. The key is exported as base64url
(`exportKeyBase64Url`) and carried in the share link's URL fragment, which is
never sent to the server.

### Password mode

`deriveKeyAndVerifier(password, salt, iterations, fragmentSecret)` derives
both the encryption key and a server-checkable verifier from a user-supplied
password plus a random value carried in the link. This is a hybrid
(1Password-style) scheme: decryption requires **both** the password and the
link.

1. PBKDF2-SHA256 over the password, with a 16-byte random salt
   (`generateSalt`) and `PBKDF2_ITERATIONS` (600,000) iterations, produces a
   256-bit password-derived key `pdk`. One block is enough — an attacker
   cracking the password pays the same per-guess cost regardless of how many
   blocks are derived.
2. `generateFragmentSecret()` produces `R`, 32 random bytes that are appended
   to the share link's URL fragment (like a random-mode key) and never sent
   to the server.
3. Two HKDF expansions (empty salt, since the inputs are already uniform —
   expand-only usage per RFC 5869):
   - the AES-256-GCM encryption key = `HKDF-Expand(pdk ‖ R,
     info="secretshare:v2:enc")`, which never leaves the browser. Both `pdk`
     and `R` are required to reconstruct it.
   - a verifier = `HKDF-Expand(pdk, info="secretshare:v1:verify")` — `pdk`
     only. The server can store and check it on reveal without being able to
     turn it back into the key, and mixing `R` in would only break that
     check. Unchanged from v1.

The server-supplied iteration count on reveal is validated against
`MIN_PBKDF2_ITERATIONS`/`MAX_PBKDF2_ITERATIONS` before use, since it round-trips
through the server: too low weakens brute-force resistance, too high risks a
browser-side DoS.

## Envelope format

`encryptData`/`decryptData` produce and consume a versioned envelope string:

```
v1:<base64 IV>:<base64 ciphertext>
```

- A fresh 12-byte random IV is generated per encryption
  (`crypto.getRandomValues`), so identical plaintexts never produce
  identical ciphertexts.
- AES-256-GCM is used with the secret's id passed as additional authenticated
  data (AAD). The id is authenticated but not encrypted: decryption fails if
  the ciphertext is ever presented under a different id, which prevents the
  server from swapping ciphertexts between records without detection.
- `decryptData` rejects any envelope that isn't exactly 3 `:`-separated
  parts, isn't tagged `v1`, doesn't have a 12-byte IV, or has an empty
  ciphertext component — before ever attempting decryption.

## Length-hiding padding

AES-GCM ciphertext is exactly as long as its plaintext — no padding is added
by the cipher itself. Left as-is, this means ciphertext length leaks the
exact byte length of the original secret to anyone who can see it (e.g. a
5-byte password is trivially distinguishable from a 3KB SSH key by size
alone, without decrypting anything).

To prevent this, the plaintext is transformed before encryption and restored
after decryption:

1. **Pad** (`padPlaintext`): prepend a 4-byte big-endian `uint32` header
   encoding the exact byte length of the real secret (4 bytes because
   secrets can be larger than a `uint16` can express), then zero-pad the
   result up to the next 16-byte boundary. If `header + secret` already
   lands exactly on a boundary, **no** padding bytes are added — this is not
   PKCS#7-style always-pad, since the length header already disambiguates
   real content from padding.
2. **Encrypt** the resulting `[header][secret][zero padding]` buffer as a
   single AES-256-GCM plaintext — no other change to IV/nonce handling or
   key derivation.
3. **Decrypt**, then **unpad** (`unpadPlaintext`): read the first 4 bytes as
   a big-endian `uint32` → `N`, and return exactly the next `N` bytes as the
   real secret, discarding the rest as padding. If `N` exceeds the remaining
   buffer length, this throws — a defensive check against a corrupted or
   malformed payload, independent of GCM's own tamper detection (which would
   already have rejected an altered ciphertext before unpadding ever runs).

This hides the secret's *exact* length (rounded to a 16-byte granularity,
plus the 4-byte header) but does **not** hide its *category* — a short
password and a short SSH key fragment can still land in the same padded
size bucket, but a 3-byte password and a 3KB key no longer produce
distinguishably different ciphertext lengths at the byte level. Hiding
category via fixed-size buckets (e.g. 256B/1KB/4KB tiers) is a larger,
deliberate design decision left for a future enhancement.

## Non-goals

- Bucket-tier padding for category-hiding (password vs. key vs. certificate
  indistinguishability).
- Any change to the maximum secret size or server-side upload/storage
  validation — those are unrelated to the client-side encryption scheme
  described here.
