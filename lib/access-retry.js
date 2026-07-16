// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
import { readAccessCookie } from "./identity.js";
import { isReserved } from "./store.js";

function isRetryablePath(pathname) {
  if (pathname === "/") return true;
  if (!pathname.startsWith("/")) return false;
  const id = pathname.slice(1);
  return !id.includes("/") && !isReserved(id);
}

export function accessRetryTarget(req, { mode, param }) {
  if (mode !== "jwt" || req?.method !== "GET" || !readAccessCookie(req)) return null;
  const assertion = req.headers?.["cf-access-jwt-assertion"];
  if (Array.isArray(assertion) ? assertion.some(Boolean) : assertion) return null;

  try {
    const url = new URL(req.url || "/", "http://artifact-mcp.local");
    if (!isRetryablePath(url.pathname) || url.searchParams.has(param)) return null;
    url.searchParams.set(param, "1");
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
