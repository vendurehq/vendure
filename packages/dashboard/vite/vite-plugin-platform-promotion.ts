import { DashboardPromotionV1, isDashboardPromotionV1 } from '@vendure/common/lib/platform-promotion';
import { platformPromotionSnapshot } from '@vendure/common/lib/platform-promotion-snapshot';
import { Plugin } from 'vite';

import { getActivePluginNames } from './utils/get-active-plugin-info.js';
import { ConfigLoaderApi, getConfigLoaderApi } from './vite-plugin-config-loader.js';

const virtualModuleId = 'virtual:vendure-platform-promotion';
const resolvedVirtualModuleId = `\0${virtualModuleId}`;

export const PLATFORM_CATALOG_URL = 'https://api.vendure.io/v1/catalog';
export const PLATFORM_CATALOG_TIMEOUT_MS = 2000;
/**
 * Set this environment variable to `true` to skip the catalog fetch. The build then uses
 * the snapshot that ships with `@vendure/common`.
 */
export const SKIP_PLATFORM_CATALOG_FETCH_ENV = 'VENDURE_DASHBOARD_SKIP_PLATFORM_CATALOG_FETCH';
/**
 * Set this environment variable to `false` to turn off all Platform promotion in the Dashboard.
 */
export const PLATFORM_PROMOTION_ENV = 'VENDURE_DASHBOARD_PLATFORM_PROMOTION';
const LICENSE_GUARD_PLUGIN_NAME = 'LicenseGuardPlugin';
const EMPTY_PROMOTION: DashboardPromotionV1 = {
    version: 1,
    navSections: [],
    navItems: [],
    pageBlocks: [],
    actions: [],
    capabilities: [],
};

/**
 * Fetches the `dashboardPromotion` data from the Vendure catalog one time. If the fetch
 * is skipped, fails, takes longer than the timeout or returns an unknown version, it
 * returns the snapshot that ships with `@vendure/common`. It never throws.
 */
export async function loadDashboardPromotion(
    log: (message: string) => void = () => undefined,
): Promise<DashboardPromotionV1> {
    if (process.env[SKIP_PLATFORM_CATALOG_FETCH_ENV] === 'true') {
        return platformPromotionSnapshot;
    }
    try {
        const response = await fetch(PLATFORM_CATALOG_URL, {
            signal: AbortSignal.timeout(PLATFORM_CATALOG_TIMEOUT_MS),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const body = (await response.json()) as { dashboardPromotion?: unknown } | null;
        if (!isDashboardPromotionV1(body?.dashboardPromotion)) {
            throw new Error('the response has no valid dashboardPromotion with version 1');
        }
        return body.dashboardPromotion;
    } catch (e: unknown) {
        const reason = e instanceof Error ? e.message : String(e);
        log(`Could not fetch the Platform catalog (${reason}). Using the bundled snapshot.`);
        return platformPromotionSnapshot;
    }
}

/**
 * This Vite plugin supplies the `virtual:vendure-platform-promotion` module. It holds the
 * Platform catalog data (`dashboardPromotion`) that the Dashboard uses to show locked
 * Platform items, and `licenseGuardConfigured`, which is `true` when the Vendure config
 * contains the License Guard plugin.
 *
 * The data is read at build time (and at dev server start), so the browser makes no
 * request to `api.vendure.io`.
 *
 * When `enabled` is `false` or `VENDURE_DASHBOARD_PLATFORM_PROMOTION` is `false`, the
 * plugin sends no request, the module holds no promotion data, and
 * `platformPromotionEnabled` is `false`.
 */
export function platformPromotionPlugin(options: { enabled?: boolean } = {}): Plugin {
    let configLoaderApi: ConfigLoaderApi;
    let dashboardPromotion: Promise<DashboardPromotionV1> | undefined;
    const isEnabled = () => options.enabled !== false && process.env[PLATFORM_PROMOTION_ENV] !== 'false';
    const getDashboardPromotion = (log: (message: string) => void) =>
        (dashboardPromotion ??= isEnabled() ? loadDashboardPromotion(log) : Promise.resolve(EMPTY_PROMOTION));
    return {
        name: 'vendure:platform-promotion',
        configResolved({ plugins }) {
            configLoaderApi = getConfigLoaderApi(plugins);
        },
        buildStart() {
            void getDashboardPromotion(message => this.warn(message));
        },
        resolveId(id) {
            if (id === virtualModuleId) {
                return resolvedVirtualModuleId;
            }
        },
        async load(id) {
            if (id === resolvedVirtualModuleId) {
                const [promotion, { vendureConfig }] = await Promise.all([
                    getDashboardPromotion(message => this.warn(message)),
                    configLoaderApi.getVendureConfig(),
                ]);
                const licenseGuardConfigured =
                    getActivePluginNames(vendureConfig).has(LICENSE_GUARD_PLUGIN_NAME);
                return [
                    `export const dashboardPromotion = ${JSON.stringify(promotion)};`,
                    `export const licenseGuardConfigured = ${JSON.stringify(licenseGuardConfigured)};`,
                    `export const platformPromotionEnabled = ${JSON.stringify(isEnabled())};`,
                ].join('\n');
            }
        },
    };
}
