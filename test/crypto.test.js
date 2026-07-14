import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "../lib/crypto.js";

test("webhook encryption round-trips with AES-256-GCM", () => {
  const key = randomBytes(32).toString("base64");
  const plaintext = "https://discord.com/api/webhooks/123456/very-secret-token";

  const encrypted = encrypt(plaintext, key);

  assert.equal(decrypt(encrypted, key), plaintext);
  assert.doesNotMatch(encrypted.ciphertext, /very-secret-token/);
  assert.ok(encrypted.nonce);
  assert.ok(encrypted.tag);

  const tamperedBytes = Buffer.from(encrypted.ciphertext, "base64");
  tamperedBytes[0] ^= 1;
  const tampered = { ...encrypted, ciphertext: tamperedBytes.toString("base64") };
  assert.throws(() => decrypt(tampered, key));
});

test("webhook encryption requires a 32-byte base64 key", () => {
  assert.throws(() => encrypt("secret", "not-base64"), /32-byte base64/);
  assert.throws(() => encrypt("secret", Buffer.alloc(31).toString("base64")), /32-byte base64/);
});
