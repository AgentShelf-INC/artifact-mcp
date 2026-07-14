// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
let warnedAboutPlaintextFallback = false;

export function parseEncryptionKey(value = process.env.WEBHOOK_ENC_KEY) {
  const encoded = String(value || "").trim();
  if (!encoded) return undefined;

  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("WEBHOOK_ENC_KEY must be a 32-byte base64 value.");
  }
  return key;
}

export function warnIfWebhookEncryptionDisabled(value = process.env.WEBHOOK_ENC_KEY) {
  if (String(value || "").trim() || warnedAboutPlaintextFallback) return;
  warnedAboutPlaintextFallback = true;
  console.warn(
    "[artifact-mcp] WARNING: WEBHOOK_ENC_KEY is unset — Discord webhook URLs will be stored " +
    "in PLAINTEXT. Set a 32-byte base64 key to encrypt webhook credentials at rest."
  );
}

export function encrypt(plaintext, keyValue = process.env.WEBHOOK_ENC_KEY) {
  const key = parseEncryptionKey(keyValue);
  if (!key) throw new Error("WEBHOOK_ENC_KEY must be a 32-byte base64 value.");

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

export function decrypt(record, keyValue = process.env.WEBHOOK_ENC_KEY) {
  const key = parseEncryptionKey(keyValue);
  if (!key) throw new Error("WEBHOOK_ENC_KEY is required to decrypt webhook URLs.");

  const ciphertext = Buffer.from(String(record?.ciphertext ?? record?.url_cipher ?? ""), "base64");
  const nonce = Buffer.from(String(record?.nonce ?? record?.url_nonce ?? ""), "base64");
  const tag = Buffer.from(String(record?.tag ?? record?.url_tag ?? ""), "base64");
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
