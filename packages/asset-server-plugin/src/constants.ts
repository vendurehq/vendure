export const loggerCtx = 'AssetServerPlugin';
export const DEFAULT_CACHE_HEADER = 'public, max-age=15552000';
export const ASSET_SERVER_PLUGIN_INIT_OPTIONS = Symbol('ASSET_SERVER_PLUGIN_INIT_OPTIONS');

/**
 * CSP applied to every served asset: denies scripts and subresources, so a scriptable asset
 * whose mime type we misidentified still cannot execute script.
 */
export const ASSET_CSP_HEADER = "default-src 'none'; script-src 'none'";
/**
 * CSP applied to markup assets (SVG/HTML/XML) on top of a forced download: the extra `sandbox`
 * token sandboxes the document as defence in depth. Kept off non-markup assets so that e.g. PDFs
 * still render inline in the browser's built-in viewer.
 */
export const ASSET_MARKUP_CSP_HEADER = `${ASSET_CSP_HEADER}; sandbox`;
/**
 * Mime types (ignoring any `; charset=…`) denoting a markup document a browser could execute
 * script from. `*+xml` (e.g. `image/svg+xml`) is matched separately by suffix.
 */
export const MARKUP_MIME_TYPES = ['text/html', 'text/xml', 'application/xml'];
