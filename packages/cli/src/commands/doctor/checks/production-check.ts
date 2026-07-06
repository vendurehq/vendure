import {
    SUPER_ADMIN_USER_IDENTIFIER,
    SUPER_ADMIN_USER_PASSWORD,
} from '@vendure/common/lib/shared-constants';
import { RuntimeVendureConfig } from '@vendure/core';

import { CheckResult } from '../types';

/**
 * Production profile checks. Inspects the loaded RuntimeVendureConfig for settings
 * that are commonly unsafe in production environments.
 *
 * Only runs when `--profile production` is passed.
 */
export async function runProductionCheck(config: RuntimeVendureConfig): Promise<CheckResult> {
    const details: string[] = [];
    let worstStatus: 'pass' | 'warn' | 'fail' = 'pass';

    function fail(message: string) {
        worstStatus = 'fail';
        details.push(`FAIL: ${message}`);
    }

    function warn(message: string) {
        if (worstStatus === 'pass') worstStatus = 'warn';
        details.push(`WARN: ${message}`);
    }

    // 1. Auth disabled
    if (config.authOptions.disableAuth) {
        fail('authOptions.disableAuth is enabled');
    }

    // 2. Default superadmin credentials
    const { identifier, password } = config.authOptions.superadminCredentials;
    if (identifier === SUPER_ADMIN_USER_IDENTIFIER || identifier === 'superadmin') {
        warn('Default superadmin identifier "superadmin" is in use');
    }
    if (password === SUPER_ADMIN_USER_PASSWORD || password === 'superadmin') {
        warn('Default superadmin password "superadmin" is in use');
    }

    // 3. Cookie secret -- if using cookie auth, the secret should be explicitly set.
    // The default is randomBytes(16) which changes on every restart, breaking sessions
    // across multiple instances or restarts.
    const tokenMethod = config.authOptions.tokenMethod;
    const usesCookies = tokenMethod === 'cookie' || (Array.isArray(tokenMethod) && tokenMethod.includes('cookie'));
    if (usesCookies) {
        const secret = config.authOptions.cookieOptions?.secret;
        if (!secret) {
            warn('Cookie auth enabled but no cookie secret configured');
        }
    }

    // 4. Introspection enabled
    if (config.apiOptions.introspection) {
        warn('GraphQL introspection is enabled');
    }

    // 5. Playground enabled
    if (config.apiOptions.adminApiPlayground) {
        warn('Admin API playground is enabled');
    }
    if (config.apiOptions.shopApiPlayground) {
        warn('Shop API playground is enabled');
    }

    // 6. Debug mode enabled
    if (config.apiOptions.adminApiDebug) {
        warn('Admin API debug mode is enabled');
    }
    if (config.apiOptions.shopApiDebug) {
        warn('Shop API debug mode is enabled');
    }

    // 7. Broad CORS with credentials
    const cors = config.apiOptions.cors;
    if (cors && typeof cors === 'object' && 'origin' in cors && cors.credentials === true) {
        const origin = cors.origin;
        if (
            origin === true ||
            origin === '*' ||
            (Array.isArray(origin) && origin.includes('*'))
        ) {
            warn('CORS allows all origins with credentials enabled');
        }
    }

    // 8. In-memory job queue strategy
    const jobQueueStrategy = config.jobQueueOptions?.jobQueueStrategy;
    if (jobQueueStrategy?.constructor?.name === 'InMemoryJobQueueStrategy') {
        warn('Using InMemoryJobQueueStrategy (not persistent across restarts)');
    }

    // 9. In-memory cache strategy
    const cacheStrategy = config.systemOptions?.cacheStrategy;
    if (cacheStrategy?.constructor?.name === 'InMemoryCacheStrategy') {
        warn('Using InMemoryCacheStrategy (not shared across instances)');
    }

    // 10. In-memory session cache strategy
    const sessionCacheStrategy = config.authOptions?.sessionCacheStrategy;
    if (sessionCacheStrategy?.constructor?.name === 'DefaultSessionCacheStrategy') {
        warn('Using DefaultSessionCacheStrategy (in-memory, not shared across instances)');
    }

    // 11. No asset storage configured
    const assetStorage = config.assetOptions?.assetStorageStrategy;
    if (assetStorage?.constructor?.name === 'NoAssetStorageStrategy') {
        warn('No asset storage strategy configured');
    }

    // 12. No asset preview configured
    const assetPreview = config.assetOptions?.assetPreviewStrategy;
    if (assetPreview?.constructor?.name === 'NoAssetPreviewStrategy') {
        warn('No asset preview strategy configured');
    }

    // 13. synchronize: true
    if (config.dbConnectionOptions?.synchronize) {
        fail('dbConnectionOptions.synchronize is enabled (use migrations instead)');
    }

    if (details.length === 0) {
        details.push('All production checks passed');
    }

    const message =
        worstStatus === 'pass'
            ? 'No production issues detected'
            : worstStatus === 'warn'
              ? 'Production warnings detected'
              : 'Production safety issues detected';

    return {
        name: 'Production',
        status: worstStatus,
        message,
        details,
    };
}
