import type { PlatformPromotionState } from '@/vdb/hooks/use-platform-promotion.js';
import { dashboardPromotion } from 'virtual:vendure-platform-promotion';

import type { DashboardPromotionCapabilityV1, DashboardPromotionV1 } from './platform-promotion-types.js';

// The catalog snapshot that ships with the Dashboard. Tests derive their cases from it, so a
// catalog refresh does not need a fixture update.
export const platformPromotionFixture: DashboardPromotionV1 = dashboardPromotion;

export function getFixtureCapability(key: string): DashboardPromotionCapabilityV1 {
    const capability = platformPromotionFixture.capabilities.find(c => c.key === key);
    if (!capability) {
        throw new Error(`The catalog snapshot has no capability "${key}"`);
    }
    return capability;
}

/** A promotion state for tests, built the same way as the state of `usePlatformPromotion`. */
export function createPlatformPromotionState(
    granted: string[] = [],
    hideAll = false,
    promotion: DashboardPromotionV1 = platformPromotionFixture,
): PlatformPromotionState {
    const grantedCapabilities = new Set(granted);
    return {
        promotion,
        capabilities: new Map(promotion.capabilities.map(c => [c.key, c])),
        licenseGuardConfigured: granted.length > 0 || hideAll,
        grantedCapabilities,
        hideAll,
        isLocked: capability => !hideAll && !grantedCapabilities.has(capability),
    };
}
