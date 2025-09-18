/**
 * WebCrypto utility functions for SecretShare
 * Handles client-side encryption/decryption using AES-GCM-256
 */

class SecretShareCrypto {
  constructor() {
    this.algorithm = 'AES-GCM';
    this.keyLength = 256;
    this.ivLength = 12; // 96 bits for GCM
    this.tagLength = 128; // 128 bits for GCM tag
    this.pbkdf2Iterations = 100000;
  }

  /**
   * Generate a random 256-bit encryption key
   * @returns {Promise<CryptoKey>} The generated key
   */
  async generateKey() {
    return await crypto.subtle.generateKey(
      {
        name: this.algorithm,
        length: this.keyLength,
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Derive a key from a password using PBKDF2
   * @param {string} password - The password to derive from
   * @param {Uint8Array} salt - Salt for key derivation (optional, generates random if not provided)
   * @returns {Promise<{key: CryptoKey, salt: Uint8Array}>} The derived key and salt used
   */
  async deriveKeyFromPassword(password, salt = null) {
    // Generate random salt if not provided
    if (!salt) {
      salt = crypto.getRandomValues(new Uint8Array(32));
    }

    // Import the password as key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    // Derive the actual encryption key
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: this.pbkdf2Iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      {
        name: this.algorithm,
        length: this.keyLength,
      },
      false, // not extractable for security
      ['encrypt', 'decrypt']
    );

    return { key, salt };
  }

  /**
   * Export a CryptoKey to a base64url string for URL storage
   * @param {CryptoKey} key - The key to export
   * @returns {Promise<string>} Base64URL encoded key (URL-safe)
   */
  async exportKeyToBase64(key) {
    const exported = await crypto.subtle.exportKey('raw', key);
    return this.arrayBufferToBase64(exported);
  }

  /**
   * Import a key from a base64url string
   * @param {string} base64urlKey - Base64URL encoded key
   * @returns {Promise<CryptoKey>} The imported key
   */
  async importKeyFromBase64(base64urlKey) {
    const keyData = this.base64ToArrayBuffer(base64urlKey);
    return await crypto.subtle.importKey(
      'raw',
      keyData,
      {
        name: this.algorithm,
        length: this.keyLength,
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt plaintext using AES-GCM
   * @param {string} plaintext - The text to encrypt
   * @param {CryptoKey} key - The encryption key
   * @returns {Promise<string>} Base64 encoded encrypted data (IV + ciphertext + tag)
   */
  async encrypt(plaintext, key) {
    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(this.ivLength));
    
    // Encode the plaintext
    const encodedText = new TextEncoder().encode(plaintext);
    
    // Encrypt the data
    const encrypted = await crypto.subtle.encrypt(
      {
        name: this.algorithm,
        iv: iv,
        tagLength: this.tagLength,
      },
      key,
      encodedText
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    // Return as base64
    return this.arrayBufferToBase64(combined);
  }

  /**
   * Decrypt ciphertext using AES-GCM
   * @param {string} encryptedData - Base64 encoded encrypted data
   * @param {CryptoKey} key - The decryption key
   * @returns {Promise<string>} The decrypted plaintext
   */
  async decrypt(encryptedData, key) {
    try {
      // Decode from base64
      const combined = this.base64ToArrayBuffer(encryptedData);
      
      // Extract IV and ciphertext
      const iv = combined.slice(0, this.ivLength);
      const ciphertext = combined.slice(this.ivLength);
      
      // Decrypt the data
      const decrypted = await crypto.subtle.decrypt(
        {
          name: this.algorithm,
          iv: iv,
          tagLength: this.tagLength,
        },
        key,
        ciphertext
      );
      
      // Decode and return the plaintext
      return new TextDecoder().decode(decrypted);
    } catch (error) {
      throw new Error('Decryption failed. Invalid key or corrupted data.');
    }
  }

  /**
   * Encrypt with a password (generates salt)
   * @param {string} plaintext - The text to encrypt
   * @param {string} password - The password to use
   * @returns {Promise<{encryptedData: string, salt: string}>} Encrypted data and salt
   */
  async encryptWithPassword(plaintext, password) {
    const { key, salt } = await this.deriveKeyFromPassword(password);
    const encryptedData = await this.encrypt(plaintext, key);
    return {
      encryptedData,
      salt: this.arrayBufferToBase64(salt)
    };
  }

  /**
   * Decrypt with a password (requires salt)
   * @param {string} encryptedData - Base64 encoded encrypted data
   * @param {string} password - The password to use
   * @param {string} saltBase64 - Base64 encoded salt
   * @returns {Promise<string>} The decrypted plaintext
   */
  async decryptWithPassword(encryptedData, password, saltBase64) {
    const salt = this.base64ToArrayBuffer(saltBase64);
    const { key } = await this.deriveKeyFromPassword(password, new Uint8Array(salt));
    return await this.decrypt(encryptedData, key);
  }

  /**
   * Generate a random URL-safe string for secret IDs
   * @param {number} length - Length in bytes (default 32)
   * @returns {string} Random hex string
   */
  generateRandomId(length = 32) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Utility: Convert ArrayBuffer to Base64URL (URL-safe base64)
   * @param {ArrayBuffer} buffer - The buffer to convert
   * @returns {string} Base64URL string
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    // Convert to base64url: replace + with -, / with _, and remove padding
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Utility: Convert Base64URL to ArrayBuffer
   * @param {string} base64url - Base64URL string
   * @returns {ArrayBuffer} The decoded buffer
   */
  base64ToArrayBuffer(base64url) {
    // Convert base64url back to base64: replace - with +, _ with /, and add padding
    let base64 = base64url
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Add padding if needed
    const padding = 4 - (base64.length % 4);
    if (padding !== 4) {
      base64 += '='.repeat(padding);
    }
    
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Check if WebCrypto is available and secure context
   * @returns {boolean} True if WebCrypto is available
   */
  isWebCryptoAvailable() {
    return typeof crypto !== 'undefined' && 
           typeof crypto.subtle !== 'undefined' &&
           (location.protocol === 'https:' || location.hostname === 'localhost');
  }

  /**
   * Generate a secure password
   * @param {number} length - Password length (default 16)
   * @param {Object} options - Password generation options
   * @returns {string} Generated password
   */
  generatePassword(length = 16, options = {}) {
    const {
      includeUppercase = true,
      includeLowercase = true,
      includeNumbers = true,
      includeSymbols = true,
      excludeSimilar = true // Exclude 0, O, l, I, etc.
    } = options;

    let charset = '';
    if (includeUppercase) charset += excludeSimilar ? 'ABCDEFGHJKMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (includeLowercase) charset += excludeSimilar ? 'abcdefghijkmnpqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz';
    if (includeNumbers) charset += excludeSimilar ? '23456789' : '0123456789';
    if (includeSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (charset === '') {
      throw new Error('At least one character type must be included');
    }

    const randomBytes = crypto.getRandomValues(new Uint8Array(length));
    let password = '';
    
    for (let i = 0; i < length; i++) {
      password += charset[randomBytes[i] % charset.length];
    }
    
    return password;
  }
}

// Example usage functions
const cryptoUtils = new SecretShareCrypto();

/**
 * High-level function to encrypt a secret with a random key
 * @param {string} secret - The secret to encrypt
 * @returns {Promise<{encryptedData: string, key: string}>} Encrypted data and key
 */
async function encryptSecret(secret) {
  if (!cryptoUtils.isWebCryptoAvailable()) {
    throw new Error('WebCrypto is not available. Please use HTTPS or localhost.');
  }

  const key = await cryptoUtils.generateKey();
  const encryptedData = await cryptoUtils.encrypt(secret, key);
  const keyBase64 = await cryptoUtils.exportKeyToBase64(key);
  
  return {
    encryptedData,
    key: keyBase64
  };
}

/**
 * High-level function to decrypt a secret with a key
 * @param {string} encryptedData - Base64 encrypted data
 * @param {string} keyBase64 - Base64 encoded key
 * @returns {Promise<string>} The decrypted secret
 */
async function decryptSecret(encryptedData, keyBase64) {
  if (!cryptoUtils.isWebCryptoAvailable()) {
    throw new Error('WebCrypto is not available. Please use HTTPS or localhost.');
  }

  const key = await cryptoUtils.importKeyFromBase64(keyBase64);
  return await cryptoUtils.decrypt(encryptedData, key);
}

/**
 * High-level function to encrypt with password
 * @param {string} secret - The secret to encrypt
 * @param {string} password - The password to use
 * @returns {Promise<{encryptedData: string, salt: string}>} Encrypted data and salt
 */
async function encryptSecretWithPassword(secret, password) {
  if (!cryptoUtils.isWebCryptoAvailable()) {
    throw new Error('WebCrypto is not available. Please use HTTPS or localhost.');
  }

  return await cryptoUtils.encryptWithPassword(secret, password);
}

/**
 * High-level function to decrypt with password
 * @param {string} encryptedData - Base64 encrypted data
 * @param {string} password - The password to use
 * @param {string} salt - Base64 encoded salt
 * @returns {Promise<string>} The decrypted secret
 */
async function decryptSecretWithPassword(encryptedData, password, salt) {
  if (!cryptoUtils.isWebCryptoAvailable()) {
    throw new Error('WebCrypto is not available. Please use HTTPS or localhost.');
  }

  return await cryptoUtils.decryptWithPassword(encryptedData, password, salt);
}