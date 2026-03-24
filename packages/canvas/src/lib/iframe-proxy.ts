/**
 * iframe-proxy — fetches external pages via CORS proxy to bypass X-Frame-Options.
 * Uses allorigins.win as the primary proxy.
 * Returns the full HTML with a <base href> injected for relative URLs.
 */

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

const PROXIES = [
  (url: string) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
  (url: string) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

export async function fetchViaProxy(url: string): Promise<string | null> {
  if (!url || url === "about:blank" || !url.startsWith("http")) return null;

  // Return cached result
  if (cache.has(url)) return cache.get(url)!;

  // Deduplicate in-flight requests
  if (pending.has(url)) return pending.get(url)!;

  const promise = (async () => {
    for (const makeProxyUrl of PROXIES) {
      try {
        const resp = await fetch(makeProxyUrl(url));
        if (!resp.ok) continue;
        const html = await resp.text();
        if (!html || html.length < 100) continue;

        // Inject <base href> so relative URLs resolve against the original site
        const patched = html.replace(
          /<head([^>]*)>/i,
          `<head$1><base href="${url}">`,
        );
        cache.set(url, patched);
        return patched;
      } catch { /* try next */ }
    }
    return null;
  })();

  pending.set(url, promise);
  const result = await promise;
  pending.delete(url);
  return result;
}

export function getCachedProxy(url: string): string | null {
  return cache.get(url) ?? null;
}

export function clearProxyCache(): void {
  cache.clear();
}
