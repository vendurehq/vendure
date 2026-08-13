/**
 * @description
 * Derives the router `basepath` from the running module's own URL.
 *
 * Works in BOTH source-shipping mode (`<base>/src/app/main.tsx`) and the
 * experimental bundle mode (`<base>/dist/bundle/...`). Using the module URL is
 * stable regardless of which sub-route the page was first loaded on — reading
 * `document.baseURI` instead breaks deep-link navigation because it reflects
 * the current page URL, not the dashboard root (see issue #4719).
 *
 * The regex anchors on the marker directory (`src/app` / `dist/bundle`) rather
 * than the entry filename: in bundle mode Vite code-splits this logic into a
 * hashed chunk served from `dist/bundle/chunks/main-<hash>.js`, so `moduleUrl`
 * points at the chunk, not `dist/bundle/main.js`. The match is greedy so it
 * anchors on the LAST occurrence of the marker — which is always the
 * dashboard's own entry, since the entry file is the final path segment. This
 * means an intermediate `/src/app/` or `/dist/bundle/` in the deployment base
 * cannot truncate the result.
 *
 * @param moduleUrl - typically `import.meta.url` of the calling module.
 * @param fallbackBase - used when the module URL yields no base, typically
 * `import.meta.env.BASE_URL`.
 * @returns the normalized base (leading slash, no trailing slash), or
 * `undefined` when the dashboard is mounted at the root.
 */
export function deriveBaseUrl(moduleUrl: string, fallbackBase: string | undefined): string | undefined {
    let derived: string | undefined;
    try {
        if (moduleUrl) {
            const entryRe = /^(.*)\/(?:src\/app|dist\/bundle)\//;
            const m = entryRe.exec(new URL(moduleUrl).pathname);
            if (m) derived = m[1] || '/';
        }
    } catch {
        // Ignore — fall back to `fallbackBase` below.
    }
    const baseUrl = derived ?? fallbackBase;
    if (!baseUrl || baseUrl === '/') return undefined;
    const normalized = baseUrl.startsWith('/') ? baseUrl : '/' + baseUrl;
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}
