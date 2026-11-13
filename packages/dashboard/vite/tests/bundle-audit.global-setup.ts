import { join } from 'node:path';

import { buildShippedBundle } from './utils/build-shipped-bundle.js';

/**
 * With RUN_BUNDLE_AUDIT=true, the bundle audits (`bundle-singleton.spec.ts` and
 * `bundle-singleton-dev-serving.spec.ts`) run in parallel and both read `dist/bundle`.
 * Building it once here, before any test file starts, keeps one audit from emptying
 * `dist/bundle` while the other is reading it.
 */
export default async function setup() {
    if (process.env.RUN_BUNDLE_AUDIT === 'true') {
        await buildShippedBundle(join(import.meta.dirname, '..', '..'));
    }
}
