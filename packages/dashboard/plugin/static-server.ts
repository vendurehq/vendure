import express from 'express';
import { rateLimit } from 'express-rate-limit';
import * as path from 'node:path';

/**
 * @description
 * Content-hashed bundles under `/assets/` are immutable and a single page load fires
 * ~190 chunk requests; counting them against the rate-limit bucket exhausts it within a
 * few tabs (see #4665). This predicate exempts them and is shared by both the static
 * server and the dynamic (Vite dev) proxy handler so the exemption can't drift.
 */
export const isStaticAssetRequest = (reqPath: string): boolean => reqPath.startsWith('/assets/');

/**
 * @description
 * Builds the Express router that serves the compiled Dashboard SPA as static files.
 *
 * Two concerns have to coexist under the `/assets` URL namespace:
 *
 * 1. **Vite build artifacts** — content-hashed bundles (`index-<hash>.js`, CSS, fonts,
 *    source maps) which Vite emits into the `assets` dir. A request for a hashed chunk
 *    that no longer exists (a client holding a stale `index.html` across a deploy) must
 *    return a clean `404` rather than falling through to the `index.html` history
 *    fallback — otherwise the module loader receives HTML for a `.js` request and the
 *    app hard-crashes on `Uncaught SyntaxError: Unexpected token '<'`.
 * 2. **The Assets SPA route** — the dashboard has a top-level navigation route literally
 *    named `assets` (`/assets`, `/assets/<id>`). Hard-loading it must serve `index.html`
 *    like every other deep route.
 *
 * Build artifacts always carry a file extension; SPA routes never do. We therefore only
 * emit the stale-chunk `404` for requests that look like a file, and let extensionless
 * `/assets*` requests fall through to the history fallback. See #4841.
 */
export function createDashboardStaticServer(dashboardPath: string, rateLimitRequests: number) {
    const limiter = rateLimit({
        windowMs: 60 * 1000,
        limit: rateLimitRequests,
        standardHeaders: true,
        legacyHeaders: false,
        skip: req => isStaticAssetRequest(req.path),
    });

    const dashboardServer = express.Router();
    dashboardServer.use(limiter);
    // Serve hashed assets with a long-lived immutable Cache-Control header so CDNs and
    // browsers can cache them indefinitely. `redirect: false` stops `express.static` from
    // 301-ing the bare `/assets` path to `/assets/` (which is the SPA route, not the dir).
    dashboardServer.use(
        '/assets',
        express.static(path.join(dashboardPath, 'assets'), {
            maxAge: '1y',
            immutable: true,
            redirect: false,
        }),
    );
    // Stale-chunk guard: only requests for an actual build artifact (which always has a
    // file extension) 404 here. Extensionless `/assets` and `/assets/<id>` are the Assets
    // SPA route and must fall through to the index.html history fallback below. (#4841)
    //
    // Assumption: no `/assets` SPA route segment contains a dot — true today (asset ids
    // are numeric/UUID; list filters live in the query string). The structurally robust
    // fix would be to rename Vite's `build.assetsDir` so the artifact dir and the SPA
    // route no longer share the `/assets` prefix; that is left out of scope here to avoid
    // invalidating asset URLs already baked into deployed `index.html` files.
    dashboardServer.use('/assets', (req, res, next) => {
        if (path.extname(req.path)) {
            res.status(404).end();
            return;
        }
        next();
    });
    // `redirect: false` here too, so the physically-present `assets/` directory does not
    // 301 `/assets` → `/assets/` before the SPA fallback can serve index.html.
    dashboardServer.use(express.static(dashboardPath, { redirect: false }));
    dashboardServer.use((req, res) => {
        res.sendFile('index.html', { root: dashboardPath });
    });

    return dashboardServer;
}
