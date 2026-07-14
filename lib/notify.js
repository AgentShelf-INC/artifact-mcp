// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
// Detached Discord delivery. Notification failures are deliberately isolated from callers.
import * as webhooks from "./webhooks.js";

const COLORS = {
  published: 0x2f9e74,
  updated: 0x3b82f6,
  restored: 0x8b5cf6,
  deleted: 0xdc2626,
  feedback: 0xf59e0b,
  resolved: 0x16a34a
};

function text(value, max) {
  const valueText = String(value || "").trim();
  return valueText.length > max ? `${valueText.slice(0, Math.max(0, max - 1))}…` : valueText;
}

function bytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildEmbed(event, payload = {}) {
  const artifactEvent = ["published", "updated", "restored", "deleted"].includes(event);
  const title = text(payload.title || (event === "feedback" ? "New feedback" : event === "resolved" ? "Feedback resolved" : "Artifact"), 256);
  const embed = {
    color: COLORS[event] || 0x64748b,
    author: { name: text(payload.org || "Artifact Index", 256) },
    title,
    ...(payload.url ? { url: String(payload.url) } : {}),
    fields: []
  };
  if (artifactEvent) {
    embed.description = text(payload.description, 2048) || `${event[0].toUpperCase()}${event.slice(1)} artifact`;
    embed.fields = [
      { name: "Publisher", value: text(payload.uploaderLabel || "Unknown", 1024), inline: true },
      { name: "Category", value: text(payload.category || "Uncategorized", 1024), inline: true },
      { name: "Revision", value: String(payload.revision || 1), inline: true },
      { name: "Size", value: bytes(payload.bytes), inline: true }
    ];
  } else if (event === "feedback") {
    embed.description = text(payload.body || "", 2048) || "(No message)";
    embed.fields = [
      { name: "Viewer", value: text(payload.viewerEmail || "Unknown", 1024), inline: true },
      { name: "Revision", value: String(payload.revision || 1), inline: true }
    ];
  } else if (event === "resolved") {
    embed.description = "Feedback resolved";
    embed.fields = [{ name: "Resolver", value: text(payload.resolver || "Unknown", 1024), inline: true }];
  }
  return { embeds: [embed] };
}

async function deliver(row, event, payload, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetchImpl(row.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildEmbed(event, payload)),
      signal: controller.signal,
      redirect: "error"
    });
    if (!response?.ok) throw new Error(`Discord returned HTTP ${response?.status || "error"}`);
    webhooks.recordResult(row.id, true);
    return { ok: true };
  } catch (error) {
    const message = String(error?.message || error || "Webhook delivery failed.");
    try { webhooks.recordResult(row.id, false, message); } catch {}
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export function emit(event, org, payload = {}, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const rows = webhooks.forEvent(org, event);
    for (const row of rows) void deliver(row, event, { ...payload, org }, fetchImpl);
  } catch {}
}

// This is intentionally awaited by the admin Test button; ordinary emits stay detached.
export async function test(webhookRow, { fetchImpl = globalThis.fetch } = {}) {
  if (!webhookRow?.url) return { ok: false, error: "Unknown webhook." };
  return deliver(webhookRow, "published", {
    org: webhookRow.org,
    title: "Webhook test",
    url: "http://localhost:3480",
    uploaderLabel: "Artifact Index",
    category: "Notifications",
    revision: 1,
    bytes: 0
  }, fetchImpl);
}

export { COLORS as EVENT_COLORS };
