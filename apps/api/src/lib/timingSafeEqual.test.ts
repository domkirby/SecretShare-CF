import { describe, expect, test } from "vitest";
import { timingSafeEqual } from "./timingSafeEqual";

describe("timingSafeEqual", () => {
  test("matches identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  test("rejects a single differing character", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "Abc")).toBe(false);
  });

  test("rejects differing lengths, including a prefix", () => {
    // A prefix must not compare equal — otherwise a truncated verifier would
    // pass the reveal check.
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("abcd", "abc")).toBe(false);
    expect(timingSafeEqual("", "a")).toBe(false);
  });

  test("compares the whole string, not just the first difference", () => {
    expect(timingSafeEqual("xbc", "abc")).toBe(false);
    expect(timingSafeEqual("abx", "abc")).toBe(false);
  });

  test("handles base64 payloads of the length the API actually compares", () => {
    // Stored verifiers are base64 of a 32-byte HMAC: 44 characters.
    const a = "A".repeat(43) + "=";
    const b = "A".repeat(42) + "B=";
    expect(timingSafeEqual(a, a)).toBe(true);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  test("distinguishes characters above the ASCII range", () => {
    expect(timingSafeEqual("é", "e")).toBe(false);
    expect(timingSafeEqual("é", "é")).toBe(true);
  });
});
