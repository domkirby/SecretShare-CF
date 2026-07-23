CREATE TABLE secrets (
    id              TEXT PRIMARY KEY,        -- URL-safe random ID (base64url, 22 chars / 128 bits)
    ciphertext      TEXT NOT NULL,            -- "ivBase64:ciphertextBase64", stored verbatim from client
    kdf_salt        TEXT,                     -- base64, NULL if random-key mode
    kdf_iterations  INTEGER,                  -- NULL if random-key mode
    kdf_verifier    TEXT,                     -- base64, NULL if random-key mode; independent PBKDF2 derivation used to check a password before it consumes a view
    max_views       INTEGER NOT NULL DEFAULT 1,
    view_count      INTEGER NOT NULL DEFAULT 0,
    expires_at      TEXT NOT NULL,            -- ISO 8601
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    burned          INTEGER NOT NULL DEFAULT 0,  -- 1 = manually or auto burned
    failed_attempts INTEGER NOT NULL DEFAULT 0  -- wrong password-verify attempts; row is burned once this hits FAILED_ATTEMPTS_CAP
);

CREATE INDEX idx_secrets_expires_at ON secrets(expires_at);
