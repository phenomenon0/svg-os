/*! coi-serviceworker v0.1.7 - Guido Zuidhof, licensed under MIT */
/*
 * Injects COOP/COEP headers via service worker so SharedArrayBuffer works
 * alongside cross-origin iframes. Uses "credentialless" mode which allows
 * external resources to load while still enabling cross-origin isolation.
 */
if (typeof window === 'undefined') {
  // Service worker context
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener("fetch", (e) => {
    if (e.request.cache === "only-if-cached" && e.request.mode !== "same-origin") return;
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.status === 0) return res;
        const headers = new Headers(res.headers);
        headers.set("Cross-Origin-Embedder-Policy", "credentialless");
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      }).catch((err) => console.error("[coi-sw]", err))
    );
  });
} else {
  // Main page context — register the service worker
  (async () => {
    if (window.crossOriginIsolated) return; // already isolated
    if (!window.isSecureContext) { console.warn("[coi-sw] requires HTTPS"); return; }

    const reg = await navigator.serviceWorker.register(
      new URL(document.currentScript.src).pathname
    );

    if (reg.active && !navigator.serviceWorker.controller) {
      // Service worker active but not controlling — reload to activate
      window.location.reload();
    } else if (!reg.active) {
      // Wait for installation to complete, then reload
      const sw = reg.installing || reg.waiting;
      await new Promise((resolve) => {
        sw.addEventListener("statechange", () => {
          if (sw.state === "activated") resolve(undefined);
        });
      });
      window.location.reload();
    }
  })();
}
