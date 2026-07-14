// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
// Network-isolated HTML-to-PNG renderer. All submitted HTML is hostile input.
import http from "node:http";
import { fork } from "node:child_process";

const PORT = positiveInteger(process.env.PORT, 3000);
const RENDER_TIMEOUT_MS = positiveInteger(process.env.RENDER_TIMEOUT_MS, 7000);
const MAX_BODY_BYTES = positiveInteger(process.env.MAX_BODY_BYTES, 5 * 1024 * 1024);
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 630;
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

let rendering = false;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedDimension(value, fallback, maximum) {
  const parsed = positiveInteger(value, fallback);
  return Math.min(parsed, maximum);
}

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": buffer.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(buffer);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
}

function killProcessGroup(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch {}
  }
}

function renderHtml(html, width, height) {
  return new Promise((resolve, reject) => {
    const child = fork(new URL("./worker.js", import.meta.url), [], {
      detached: true,
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    let settled = false;
    let timer;
    const finish = (error, png) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killProcessGroup(child);
      if (error) reject(error);
      else resolve(png);
    };
    timer = setTimeout(() => finish(new Error("render timed out")), RENDER_TIMEOUT_MS);
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (!settled) finish(new Error(`render worker exited (${signal || code})`));
    });
    child.once("message", (message) => {
      if (!message?.ok || !Buffer.isBuffer(message.png)) finish(new Error("render failed"));
      else finish(null, message.png);
    });
    child.send({ html, width, height, timeoutMs: RENDER_TIMEOUT_MS }, (error) => {
      if (error) finish(error);
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/render") {
    send(res, 404, JSON.stringify({ error: "not found" }));
    return;
  }
  if (rendering) {
    send(res, 503, JSON.stringify({ error: "renderer busy" }));
    return;
  }

  rendering = true;
  try {
    const input = await readJson(req);
    if (typeof input?.html !== "string") {
      send(res, 400, JSON.stringify({ error: "html must be a string" }));
      return;
    }
    const width = boundedDimension(input.width, DEFAULT_WIDTH, MAX_WIDTH);
    const height = boundedDimension(input.height, DEFAULT_HEIGHT, MAX_HEIGHT);
    const png = await renderHtml(input.html, width, height);
    send(res, 200, png, "image/png");
  } catch (error) {
    send(res, error?.status || 500, JSON.stringify({ error: error?.status ? error.message : "render failed" }));
  } finally {
    rendering = false;
  }
});

server.requestTimeout = RENDER_TIMEOUT_MS + 2000;
server.headersTimeout = RENDER_TIMEOUT_MS + 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`[artifact-preview] listening on 0.0.0.0:${PORT}`));
