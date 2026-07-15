// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
// One hostile render per process; the parent kills this process group at the wall deadline.
import { chromium } from "playwright";

process.once("message", async ({ html, width, height, timeoutMs }) => {
  let browser;
  let context;
  let png;
  try {
    // The container is the isolation boundary (network-isolated, read-only, non-root, cap_drop ALL,
    // seccomp, resource-limited). Chromium's in-process sandbox needs CAP_SYS_CHROOT / user
    // namespaces, which the hardened compose deliberately removes, so run without it here.
    browser = await chromium.launch({ chromiumSandbox: false, timeout: timeoutMs });
    context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      acceptDownloads: false,
      serviceWorkers: "block",
      offline: true
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      const dataSubresource = url.startsWith("data:") && !request.isNavigationRequest();
      if (dataSubresource) await route.continue();
      else await route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("popup", (popup) => { void popup.close().catch(() => {}); });
    page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => {}); });
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    png = await page.screenshot({
      type: "png",
      animations: "disabled",
      caret: "hide",
      clip: { x: 0, y: 0, width, height },
      timeout: timeoutMs
    });
  } catch {
    png = null;
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  if (process.connected) {
    process.send(png ? { ok: true, png } : { ok: false }, () => process.exit(0));
  } else {
    process.exit(1);
  }
});
